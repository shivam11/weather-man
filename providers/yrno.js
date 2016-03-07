var axios = require('axios');
var moment = require('moment');
var xml2json = require('xml2json');
var CurrentResult = require('./currentResult');
var MalformedResponse = require('../utils/exceptions').MalformedResponse;
var constants = require('../utils/constants');

//Reference: http://api.yr.no/weatherapi/weathericon/1.1/documentation
function condition(code) {
    var returnCode = constants.CLEAR;

    if (code > 100) {
        code -= 100;
    }

    var map = {
        1: constants.CLEAR, //1 Sun
        2: constants.CLOUDY, //2 LightCloud
        3: constants.CLOUDY, //3 PartlyCloud
        4: constants.CLOUDY, //4 Cloud
        5: constants.LIGHT_RAIN, //5 LightRainSun
        6: constants.THUNDERSTORM, //6 LightRainThunderSun
        7: constants.SNOW, //7 SleetSun
        8: constants.SNOW, //8 SnowSun
        9: constants.LIGHT_RAIN, //9 LightRain
        10: constants.RAIN, //10 Rain
        11: constants.THUNDERSTORM, //11 RainThunder
        12: constants.SNOW, //12 Sleet
        13: constants.SNOW, //13 Snow
        14: constants.SNOW_THUNDERSTORM, //14 SnowThunder
        15: constants.FOG, //15 Fog
        20: constants.SNOW_THUNDERSTORM, //20 SleetSunThunder
        21: constants.SNOW_THUNDERSTORM, //21 SnowSunThunder
        22: constants.THUNDERSTORM, //22 LightRainThunder
        23: constants.SNOW_THUNDERSTORM, //23 SleetThunder
        24: constants.THUNDERSTORM, //24 DrizzleThunderSun
        25: constants.THUNDERSTORM, //25 RainThunderSun
        26: constants.SNOW_THUNDERSTORM, //26 LightSleetThunderSun
        27: constants.SNOW_THUNDERSTORM, //27 HeavySleetThunderSun
        28: constants.SNOW_THUNDERSTORM, //28 LightSnowThunderSun
        29: constants.SNOW_THUNDERSTORM, //29 HeavySnowThunderSun
        30: constants.THUNDERSTORM, //30 DrizzleThunder
        31: constants.SNOW_THUNDERSTORM, //31 LightSleetThunder
        32: constants.SNOW_THUNDERSTORM, //32 HeavySleetThunder
        33: constants.SNOW_THUNDERSTORM, //33 LightSnowThunder
        34: constants.SNOW_THUNDERSTORM, //34 HeavySnowThunder
        40: constants.LIGHT_RAIN, //40 DrizzleSun
        41: constants.RAIN, //41 RainSun
        42: constants.SNOW, //42 LightSleetSun
        43: constants.SNOW, //43 HeavySleetSun
        44: constants.SNOW, //44 LightSnowSun
        45: constants.SNOW, //45 HeavysnowSun
        46: constants.LIGHT_RAIN, //46 Drizzle
        47: constants.SNOW, //47 LightSleet
        48: constants.SNOW, //48 HeavySleet
        49: constants.SNOW, //49 LightSnow
        50: constants.SNOW, //50 HeavySnow
    };

    if (map[code]) {
        returnCode = map[code];
    }

    return returnCode;
}

function convertTime(timestamp) {
    var date = new Date(timestamp);
    return date.getHours() * 60 + date.getMinutes();
}

function getCurrent(lat, lng, apiKey, getSunrise) {
    getSunrise = (getSunrise === undefined) ? true : getSunrise;

    var url = 'http://api.yr.no/weatherapi/locationforecast/1.9/?lat=' + lat + ';lon=' + lng;
    return axios.get(url).then(function(res) {
        var result = new CurrentResult();
        var json = xml2json.toJson(res.data, {object: true});

        if (json.weatherdata && json.weatherdata.product && json.weatherdata.product.time) {
            var simple = [];
            var full = [];
            for (var index in json.weatherdata.product.time) {
                if (json.weatherdata.product.time[index].location.symbol) {
                    simple.push(json.weatherdata.product.time[index]);
                }
                else {
                    full.push(json.weatherdata.product.time[index]);
                }
            }

            //From https://github.com/evanshortiss/yr.no-forecast
            var simpleWeather = null;
            var fullWeather = null;
            var maxDifference = Infinity;
            var now = moment.utc(Date.now());

            for (var i in simple) {
                var to = moment.utc(simple[i].to);
                var from = moment.utc(simple[i].from);

                if ((from.isSame(now) || from.isBefore(now)) && (to.isSame(now) || to.isAfter(now))) {
                    var diff = Math.abs(to.diff(from));
                    if (diff < maxDifference) {
                        maxDifference = diff;
                        simpleWeather = simple[i];
                    }
                }
            }

            maxDifference = Infinity;
            for (var f in full) {
                var difference = Math.abs(moment.utc(full[f].to).diff(now));
                if (difference < maxDifference) {
                    maxDifference = difference;
                    fullWeather = full[f];
                }
            }

            if (!fullWeather) {
                fullWeather = simpleWeather;
            }
            else if (simpleWeather) {
                for (var key in simpleWeather.location) {
                    fullWeather.location[key] = simpleWeather.location[key];
                }
            }

            if (fullWeather && fullWeather.location) {
                if (fullWeather.location.temperature && fullWeather.location.temperature.value) {
                    result.setTemperature(parseInt(fullWeather.location.temperature.value), constants.CELCIUS);
                }
                else {
                    throw new MalformedResponse(constants.YRNO, 'Missing temperature data');
                }

                if (fullWeather.location.symbol && fullWeather.location.symbol.number) {
                    result.setCondition(condition(parseInt(fullWeather.location.symbol.number)));
                }
                else {
                    throw new MalformedResponse(constants.YRNO, 'Missing conditon data');
                }

                if (fullWeather.location.windSpeed && fullWeather.location.windSpeed.mps) {
                    result.setWindSpeed(parseFloat(fullWeather.location.windSpeed.mps), constants.METERS);
                }

                if (fullWeather.location.humidity && fullWeather.location.humidity.value && fullWeather.location.humidity.unit == 'percent') {
                    result.setHumidity(parseFloat(fullWeather.location.humidity.value));
                }

                if (getSunrise) {
                    var surl = 'http://api.yr.no/weatherapi/sunrise/1.0/?lat=' + lat + ';lon=' + lng + ';date=' + moment().format('YYYY-MM-DD');
                    return axios.get(surl).then(function(res) {
                        var sjson = xml2json.toJson(res.data, {object: true});
                        if (sjson.astrodata && sjson.astrodata.time && sjson.astrodata.time.location && sjson.astrodata.time.location.sun) {
                            result.setSunrise(convertTime(sjson.astrodata.time.location.sun.rise));
                            result.setSunset(convertTime(sjson.astrodata.time.location.sun.set));
                        }

                        return result;
                    });
                }
            }
            else {
                throw new MalformedResponse(constants.YRNO, 'Could not find weather data');
            }
        }
        else {
            throw new MalformedResponse(constants.YRNO);
        }

        return result;
    });
}

module.exports = {
    getCurrent: getCurrent,
};
