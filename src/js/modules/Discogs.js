"use strict";

var $ = require("jquery");
var querystring = require('querystring');

function Discogs() {
  var token = localStorage.discog_token;
  var me = {};

  function httpGet(path, queryString, callBack) {
    $.ajax({
      type: 'GET',
      url: 'https://api.discogs.com/' + path + '?' + queryString,
      headers: {
        'Authorization': 'Discogs token=' + token
      }
    }).done(function(data) {
      callBack(undefined, data);
    });
  }

  me.supportsDiscog = function() {
    return !!token;
  };

  me.search = function(options, callBack) {
    var query = querystring.stringify(options);
    httpGet('/database/search', query, callBack);
  };

  return me;
}

module.exports = new Discogs();
