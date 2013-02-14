var countries = require("./slim-2.json");

var countries_json = {};
for (var i = 0 ; i < countries.length; i++){
  var country = countries[i];
  countries_json[country["alpha-2"]] = country["name"];
}

exports.countries_map = countries_json;