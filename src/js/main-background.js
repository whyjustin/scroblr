"use strict";

var $       = require("jquery");
var conf    = require("./conf.json");
var firefox = require('./firefox/firefox.js');
var discogs = require('./modules/Discogs');
var utilities = require('./modules/Utilities');

window.scroblrGlobal = (function () {
    var currentTrack = null;
    var history      = [];

    function doNotScrobbleCurrentTrack() {

        if (currentTrack.noscrobble) {
            currentTrack.noscrobble = false;
        } else {
            currentTrack.noscrobble = true;
        }
        sendMessage("trackNoScrobbleSet");
    }

    /**
     * Checks the browser's local storage for preference options and returns the
     * default setting if not found. Options are stored differently based on the
     * browser, this function simplifies the process of accessing those preferences.
     *
     * @param {string} option The name of the option (ex. "pandora")
     */
    function getOptionStatus(option) {
        return !localStorage["disable_" + option];
    }

    /**
     * The initialization function, gets run once on page load (when the browser
     * window opens for the first time, or when scroblr is enabled.)
     */
    function initialize() {
        if (typeof chrome != "undefined") {
            chrome.extension.onMessage.addListener(messageHandler);
        } else if (typeof safari != "undefined") {
            safari.application.addEventListener("message", messageHandler, false);
        } else if (firefox) {
            firefox.addEventListener(messageHandler);
        }
    }

    /**
     * Handles all incoming event messages from other extension resources.
     *
     * @param {object} msg The message contents (ex. {name: "doNotScrobbleButtonClicked",
	 *                     message: null})
     */
    function messageHandler(msg) {

		if (conf.DEBUG) {
			console.log(msg.name, msg.message);
		}

        switch (msg.name) {
		case "doNotScrobbleButtonClicked":
			doNotScrobbleCurrentTrack();
			break;
		case "popupSettingsChanged":
			sendMessage("localSettingsChanged");
			break;
		case "nowPlaying":
			updateNowPlaying(msg.message);
        scrobbleHistory();
			break;
		case "trackEdited":
			updateCurrentTrack(msg.message);
			trackEditResponse();
			sendMessage("trackEditSaved");
			break;
		case "updateCurrentTrack":
			updateCurrentTrack(msg.message);
        scrobbleHistory();
			break;
        }
    }

    /**
     * Handles sending HTML5 window notifications (used mainly when a new song
     * starts playing, Chrome-only for the time being)
     *
     * @param {object} message The notification to be sent (ex. {title:
	 *                         "Now Playing", message: "Big Black - Kerosene"})
     */
    function notify(message) {
        /* globals webkitNotifications */

        var notification;

        if (!(message.image && message.image.length)) {
            message.image = "img/scroblr64.png";
        }

        if (window.webkitNotifications && getOptionStatus("notifications")) {
            notification = webkitNotifications.createNotification(
                message.image, message.title, message.message);
            notification.show();

            if (getOptionStatus("autodismiss")) {
                window.setTimeout(function () {
                    notification.cancel();
                }, 5000);
            }
        }

        if (firefox) {
            firefox.showNotification(message);
        }
    }

    function pushTrackToHistory(track) {
        if (track) {
            history.push(track);
        }

        if (history.length > 25) {
            history.splice(0, history.length - 25);
        }
    }

    /**
     * Scrobbles any tracks in the history array that have not been scrobbled yet.
     */
    function scrobbleHistory() {
        var i, max, song, track;

        for (i = 0, max = history.length; i < max; i += 1) {
            track = history[i];

            if (!track.scrobbled && getOptionStatus("scrobbling") &&
                trackShouldBeScrobbled(track)) {

                track.scrobbled = true;
                song = {
                    artist:    track.artist,
                    timestamp: Math.round(track.dateTime / 1000),
                    title:     track.title
                };

                if (track.album) {
                    song.album = track.album;
                }

                prepareScrobble(song);
            }
        }

    }

    function prepareScrobble(song) {
        if (discogs.supportsDiscog()) {
            var searchOptions = $.extend({
                artist: song.artist
            }, song.album ? {
                release_title: utilities.stripAlbumQualifiers(song.album)
            }: {
                track: song.title
            });
            discogs.search(searchOptions, function(err, data) {
                if (err) {
                    return;
                }
                if (data.results && data.results.length > 0) {
                    var result = data.results[0];
                    song.image = result.thumb;
                }
                scrobble(song);
            });
        } else {
            scrobble(song);
        }
    }

    function scrobble(song) {
        if (getOptionStatus('slack')) {
            scrobbleSlack(song);
        }
        if (getOptionStatus('hipchat')) {
            scrobbleHipChat(song);
        }
    }

    function scrobbleSlack(song) {
        var options = {
            slack: {
                username: localStorage.slack_username,
                attachment: true
            }
        };

        var json = getSlackJson(options, song);
        scrobbleSlackTrack(json);
    }

    /**
     * Constructs JSON object for Slack API
     */
    function getSlackJson(options, song) {
        if (getOptionStatus('slack_attachment')) {
            return {
                'username' : options.slack.username,
                'icon_url' : song.image,
                "mrkdwn" : true,
                "attachments": [
                    {
                        "fallback": song.title + ' - ' + song.artist + (song.album ? ' - ' + song.album : ''),
                        "title": song.title,
                        "text": song.artist + (song.album ? ' - ' + song.album : ''),
                        "thumb_url": song.image
                    }
                ]
            };
        } else {
            return {
                'username' : options.slack.username,
                "thumb_url": song.image,
                "mrkdwn" : true,
                'text' : '*' + song.title + '*\n' + song.artist + (song.album ? ' - ' + song.album : '')
            };
        }
    }

    function scrobbleSlackTrack(json) {
        $.post(localStorage.slack_webhook, JSON.stringify(json));
    }

    function scrobbleHipChat(song) {
        var json = {
            'message': song.title + ' - ' + song.artist + (song.album ? ' - ' + song.album : ''),
            'card': {
                'id': new Date().getTime().toString(),
                'style': 'application',
                'format': 'medium',
                'title': song.title,
                'description': song.artist + (song.album ? ' - ' + song.album : '')
            }
        };

        if (song.image) {
            json.card.icon = {
                'url': song.image
            };
        }

        $.ajax({
            type: 'POST',
            url: localStorage.hipchat_domain + '/v2/room/' + localStorage.hipchat_room + '/notification',
            data: JSON.stringify(json),
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            headers: {
              'Authorization': 'Bearer ' + localStorage.hipchat_token
            }
        });
    }

    /**
     * Handles sending event messages to the Chrome/Safari extension API.
     *
     * @param {string} name The name of the event to trigger
     * @param {?} message Any type of data that should be sent along with the msg
     */
    function sendMessage(name, message) {
        var popovers, i;

        if (typeof chrome != "undefined") {
            chrome.extension.sendMessage({
                name:    name,
                message: message
            });
        } else if (typeof safari != "undefined") {
            popovers = safari.extension.popovers;
            i = popovers.length;

            while (i--) {
                popovers[i].contentWindow.scroblrView.messageHandler({
                    name: name,
                    message: message
                });
            }
        } else if (firefox) {
            firefox.postMessage({
                name:    name,
                message: message
            });
        }
    }

    function trackEditResponse() {
        if (currentTrack.editrequired) {
            currentTrack.editrequired = false;
            currentTrack.noscrobble   = false;
            notify({
                message: currentTrack.artist + " - " + currentTrack.title,
                title:   "Now Playing"
            });
        }
    }

    /**
     * Determines if a track should be scrobbled or not.
     *
     * @param {Track} track
     * @return {boolean}
     * @private
     */
    function trackShouldBeScrobbled(track) {
        var artistTitlePresent, greaterThan30s, listenedTo4m, listenedToMoreThanQuarter,
            noDurationWithElapsed, serviceEnabled;

        artistTitlePresent     = (track.artist && track.title ? true : false);
        greaterThan30s         = (track.duration > 30000);
        listenedTo4m           = (track.elapsed >= 240000);
        listenedToMoreThanQuarter = (track.elapsed >= track.duration / 4);
        noDurationWithElapsed  = (!track.duration && track.elapsed > 30000);
        serviceEnabled         = getOptionStatus(track.host);

        return serviceEnabled && !track.noscrobble && artistTitlePresent && ((greaterThan30s &&
            (listenedTo4m || listenedToMoreThanQuarter)) || noDurationWithElapsed);
    }

    /**
     * Updates properties in the current song object.
     *
     * @param {object} data
     */
    function updateCurrentTrack(data) {
        if (data.id === currentTrack.id) {
            for (var key in data) {

                if (data.hasOwnProperty(key)) {

                    /*
                     * Pandora occasionally clears elapsed and durations before
                     * the next track begins, this causes lost scrobbles. Need
                     * to make sure new elapsed time is not less than previous
                     * elapsed time.
                     */
                    if ( (key === "elapsed" && data[key] > currentTrack[key]) ||
                        (key === "elapsed" && !currentTrack[key]) ||
                        key !== "elapsed") {
                        currentTrack[key] = data[key];
                    }
                }
            }
        }
    }

    /**
     * Constructs the "Now Playing" request to send to the Last.fm api
     *
     * @param {object} track
     */
    function updateNowPlaying(track) {
        if (currentTrack && currentTrack.id === track.id) {
            return;
        }

        if (track.host === "youtube" && !getOptionStatus("youtube")) {
            return false;
        }

        if (!track.artist) {
            track.editrequired = true;
            track.noscrobble   = true;
            sendMessage("trackEditRequired");
        }

        currentTrack = $.extend({}, track);
        pushTrackToHistory(currentTrack);
    }

    initialize();

    return {
        getCurrentTrack: function () {
            return currentTrack;
        },
        getHistory: function () {
            return history;
        },
        messageHandler: messageHandler
    };
}());
