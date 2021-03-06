var querystring = require('querystring');
var Promise = require('bluebird');
var request = require('request');

var util = require('./utils.js');
var supersecret = require('./config.js');

var client_id = supersecret.client_id;
var client_secret = supersecret.client_secret;
var redirect_uri = 'http://localhost:8888/callback';
var stateKey = 'spotify_auth_state';

module.exports.authorize = function(res) {
  var state = util.generateRandomString(16);
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
};

module.exports.getToken = function(req, res) {
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

        util.generateSession(req, access_token, refresh_token, function() {
          res.redirect('/');
        });
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
};

module.exports.refreshToken = function(req, res) {
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
}

module.exports.findUser = function(token, callback) {
  var authOptions = {
    url: 'https://api.spotify.com/v1/me',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    json: true
  };
  request.get(authOptions, function(error, response, body) {
    callback(token, body.id);
  })
};

module.exports.getPlaylists = function(token, userID, callback) {
  var playlistOptions = {
    url: 'https://api.spotify.com/v1/users/' + userID + '/playlists',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    json: true
  };
  request.get(playlistOptions, function(error, response, body) {
    callback(token, userID, body.items);
  })
};

module.exports.getTracks = function(token, userID, playlists, callback) {
  var playlistPromises = [];
  playlists.forEach(function(playlist) {
    //if playlist is hosted on iTunes and not Spotify, it won't have associated images
    if (playlist.images.length) {
      var playlistID = playlist.id;
      var trackOptions = {
        url: 'https://api.spotify.com/v1/users/' + userID + '/playlists/' + playlistID + '/tracks',
        headers: {
          'Authorization': 'Bearer ' + token
        },
        json: true
      };
      playlistPromises.push(util.buildPromise(trackOptions));
    }
  });
  Promise.all(playlistPromises)
    .then(function(tracks) {
      callback(tracks);
    })
};

module.exports.getArtists = function(tracks, callback) {
  var artistPromises = [];
  var artists = {};
  tracks.forEach(function(trackListings) {
    trackListings.items.forEach(function(item) {
      item.track.artists.forEach(function(artist) {
        if (!artists[artist.name]) {
          artists[artist.name] = {
            myCount: 1
          };
          var artistOptions = {
            url: 'https://api.spotify.com/v1/artists/' + artist.id,
            json: true
          };
          artistPromises.push(util.buildPromise(artistOptions));
        } else {
          artists[artist.name].myCount++;
        }
      });
    });
  });
  Promise.all(artistPromises)
    .then(function(artistObjs) {
      artistObjs.forEach(function(artistObj) {
        artists[artistObj.name].info = artistObj;
      });
      callback(artists);
    });

};
