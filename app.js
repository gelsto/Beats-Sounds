var express = require('express');
var request = require('request');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var Promise = require('bluebird');
var session = require('express-session')

var client_id = ""; // in gitignore
var client_secret = ""; // in gitignore
var redirect_uri = 'http://localhost:8888/callback';

var google_client_id = ""; // in gitignore
var google_client_secret = ""; // in gitignore

var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

var stateKey = 'spotify_auth_state';

var app = express();

app.use(session({
  secret: "super secret string"
}));

app.use(express.static(__dirname + '/public'))
  .use(cookieParser());

app.get('/login', function(req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  var scope = 'user-read-private user-read-email';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/callback', function(req, res) {

  var promisifiedGet = function(options) {
    return new Promise(function(resolve, reject) {
      request.get(options, function(error, response, body) {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      })
    })
  }
  var promisifiedPost = function(options) {
    return new Promise(function(resolve, reject) {
      request.get(options, function(error, response, body) {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      })
    })
  }

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
          refresh_token = body.refresh_token;

        req.session.regenerate(function() {
          req.session.accessToken = body.access_token;
          req.session.refreshToken = body.refresh_token;
          res.redirect('/')
        })
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

app.get('/myconcerts', function(req, res) {

  if (req.session.accessToken === undefined) {
    console.log("AHHH")
    res.end('go to login');
  } else {

    var authOptions = {
      url: 'https://api.spotify.com/v1/me',
      headers: {
        'Authorization': 'Bearer ' + req.session.accessToken
      },
      json: true
    };

    request.get(authOptions, function(error, response, body) {
      var userID = body.id

      var playlistOptions = {
        url: 'https://api.spotify.com/v1/users/' + userID + '/playlists',
        headers: {
          'Authorization': 'Bearer ' + req.session.accessToken
        },
        json: true
      };

      request.get(playlistOptions, function(error, response, body) {

        var playlist = body.items;
        var playlistPromises = [];
        playlist.forEach(function(playlist) {
          //if playlist is hosted on iTunes and not Spotify, it won't have associated images
          if (playlist.images.length) {
            var playlistID = playlist.id;
            var trackOptions = {
              url: 'https://api.spotify.com/v1/users/' + userID + '/playlists/' + playlistID + '/tracks',
              headers: {
                'Authorization': 'Bearer ' + req.session.accessToken
              },
              json: true
            };
            playlistPromises.push(
              new Promise(function(resolve, reject) {
                request.get(trackOptions, function(error, response, body) {
                  if (error) {
                    reject(error);
                  } else {
                    resolve(body.items);
                  }
                })
              })
            );
          }
        });

        Promise.all(playlistPromises)
          .then(function(playlists) {
            var artistPromises = [];
            var artists = {};
            playlists.forEach(function(trackListings) {
              trackListings.forEach(function(item) {
                item.track.artists.forEach(function(artist) {
                  if (!artists[artist.name]) {
                    artists[artist.name] = {
                      myCount: 1,
                    };
                    var artistOptions = {
                      url: 'https://api.spotify.com/v1/artists/' + artist.id,
                      json: true
                    };

                    artistPromises.push(new Promise(function(resolve, reject) {
                      request.get(artistOptions, function(error, response, body) {
                        if (error) {
                          reject(error);
                        } else {
                          resolve(body);
                        }
                      });
                    }));
                  } else {
                    artists[artist.name].myCount++;
                  }
                })
              })
            });

            Promise.all(artistPromises)
              .then(function(artistObjs) {
                artistObjs.forEach(function(artistObj) {
                  artists[artistObj.name].info = artistObj;
                })

                //SONGKICK REQUESTS HERE
                var dummyResponse = {
                  "event": [{
                    "id": 25105504,
                    "type": "Concert",
                    "uri": "http://www.songkick.com/concerts/25105504-kendrick-lamar-at-fox-theater",
                    "displayName": "Kendrick Lamar at Fox Theater (November 10, 2015)",
                    "start": {
                      "time": "20:00:00",
                      "date": "2015-11-18",
                      "datetime": "2015-11-18T20:00:00-0800"
                    },
                    "performance": [{
                      "artist": {
                        "uri": "http://www.songkick.com/artists/3277856-kendrick-lamar",
                        "displayName": "Kendrick Lamar",
                        "id": 29835,
                        "identifier": []
                      },
                      "displayName": "Kendrick Lamar",
                      "billingIndex": 1,
                      "id": 21579303,
                      "billing": "headline"
                    }],
                    "location": {
                      "city": "San Francisco, CA, US",
                      "lng": -122.4332937,
                      "lat": 37.7842398
                    },
                    "venue": {
                      "id": 6239,
                      "displayName": "Fox Theater",
                      "uri": "http://www.songkick.com/venues/953251-fox-theater",
                      "lng": -122.4332937,
                      "lat": 37.7842398,
                      "metroArea": {
                        "uri": "http://www.songkick.com/metro_areas/26330-us-sf-bay-area?utm_source=PARTNER_ID&utm_medium=partner",
                        "displayName": "SF Bay Area",
                        "country": {
                          "displayName": "US"
                        },
                        "id": 26330,
                        "state": {
                          "displayName": "CA"
                        }
                      }
                    },
                    "status": "ok",
                    "popularity": 0.012763
                  }, {
                    "id": 25317179,
                    "type": "Concert",
                    "uri": "http://www.songkick.com/concerts/25317179-ellie-goulding-at-sap-center",
                    "displayName": "Ellie Goulding at SAP Center (April 6, 2016)",
                    "start": {
                      "time": "20:00:00",
                      "date": "2015-04-06",
                      "datetime": "2015-04-06T20:00:00-0800"
                    },
                    "performance": [{
                      "artist": {
                        "uri": "http://www.songkick.com/artists/2332047-ellie-goulding",
                        "displayName": "Ellie Goulding",
                        "id": 29835,
                        "identifier": []
                      },
                      "displayName": "Ellie Goulding",
                      "billingIndex": 1,
                      "id": 21579303,
                      "billing": "headline"
                    }],
                    "location": {
                      "city": "San Francisco, CA, US",
                      "lng": -122.4332937,
                      "lat": 37.7842398
                    },
                    "venue": {
                      "id": 6239,
                      "displayName": "SAP Center",
                      "uri": "http://www.songkick.com/venues/2505-sap-center",
                      "lng": -122.4332937,
                      "lat": 37.7842398,
                      "metroArea": {
                        "uri": "http://www.songkick.com/metro_areas/26330-us-sf-bay-area?utm_source=PARTNER_ID&utm_medium=partner",
                        "displayName": "SF Bay Area",
                        "country": {
                          "displayName": "US"
                        },
                        "id": 26330,
                        "state": {
                          "displayName": "CA"
                        }
                      }
                    },
                    "status": "ok",
                    "popularity": 0.012763
                  }, {
                    "id": 25261749,
                    "type": "Concert",
                    "uri": "http://www.songkick.com/concerts/25105504-kendrick-lamar-at-fox-theater",
                    "displayName": "Jess Glynne at Mezzanine (February 8, 2016)",
                    "start": {
                      "time": "20:00:00",
                      "date": "2015-11-18",
                      "datetime": "2015-11-18T20:00:00-0800"
                    },
                    "performance": [{
                      "artist": {
                        "uri": "http://www.songkick.com/artists/4130211-jess-glynne",
                        "displayName": "Jess Glynne",
                        "id": 29835,
                        "identifier": []
                      },
                      "displayName": "Jess Glynne",
                      "billingIndex": 1,
                      "id": 21579303,
                      "billing": "headline"
                    }],
                    "location": {
                      "city": "San Francisco, CA, US",
                      "lng": -122.4332937,
                      "lat": 37.7842398
                    },
                    "venue": {
                      "id": 6239,
                      "displayName": "Mezzanine",
                      "uri": "http://www.songkick.com/venues/329-mezzanine",
                      "lng": -122.4332937,
                      "lat": 37.7842398,
                      "metroArea": {
                        "uri": "http://www.songkick.com/metro_areas/26330-us-sf-bay-area?utm_source=PARTNER_ID&utm_medium=partner",
                        "displayName": "SF Bay Area",
                        "country": {
                          "displayName": "US"
                        },
                        "id": 26330,
                        "state": {
                          "displayName": "CA"
                        }
                      }
                    },
                    "status": "ok",
                    "popularity": 0.012763
                  }]
                };
                var concerts = [];
                dummyResponse.event.forEach(function(show) {
                  show.performance.forEach(function(performer) {
                    if (artists[performer.artist.displayName]) {
                      artists[performer.artist.displayName].show = show;
                      concerts.push(artists[performer.artist.displayName]);
                    }
                  })
                })
                res.json(concerts);
              })

          })

      })
    });
  }

})

app.get('/refresh_token', function(req, res) {

  var refresh_token = req.session.refreshToken;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: {
      'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
    },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      req.session.accessToken = body.access_token;
      res.redirect('/login');
    }
  });
});

console.log('Listening on 8888');
app.listen(8888);