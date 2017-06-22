"use strict";

var $       = require("jquery");
var conf    = require("./conf.json");
var firefox = require('./firefox/firefox.js');
var discogs = require('./modules/Discogs');

window.scroblrGlobal = (function () {
    var keepalive;
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
     * Handles API request failures. Notice how it doesn't do a goddamn thing, this
     * should probably be expanded upon...
     */
    function handleFailure() {
        console.log(arguments);
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

    function keepTrackAlive() {
        window.clearTimeout(keepalive);
        keepalive = window.setTimeout(function () {
            scrobbleHistory();
            currentTrack = null;
        }, 15000);
    }

    /**
     * Handles all incoming event messages from other extension resources.
     *
     * @param {object} msg The message contents (ex. {name: "keepAlive",
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
            history.splice(0, 1);
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
                song = {
                    artist:    track.artist,
                    timestamp: Math.round(track.dateTime / 1000),
                    title:     track.title
                };

                if (track.album) {
                    song.album = track.album;
                }

                prepareScrobble(track, song);
            }
        }

    }

    function prepareScrobble(track, song) {
        if (discogs.supportsDiscog()) {
            discogs.search({
                artist: track.artist,
                release_title: track.album
            }, function(err, data) {
                if (err) {
                    return;
                }
                if (data.results && data.results.length > 0) {
                    var result = data.results[0];
                    song.image = result.thumb;
                }
                scrobble(track, song);
            });
        } else {
            scrobble(track, song);
        }
    }

    function scrobble(track, song) {
        var options = {
            slack: {
                username: localStorage.slack_username,
                attachment: true
            }
        };

        var json = getSlackJson(options, song);
        scrobbleTrack(track, json);
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
                        "fallback": song.title + ' - ' + song.artist + ' - ' + song.album,
                        "title": song.title,
                        "text": song.artist + ' - ' + song.album,
                        "thumb_url": song.image
                    }
                ]
            };
        } else {
            return {
                'username' : options.slack.username,
                "thumb_url": song.image,
                "mrkdwn" : true,
                'text' : '*' + song.title + '*\n' + song.artist + ' - ' + song.album
            };
        }
    }

    function scrobbleTrack(track, json) {
        $.post(localStorage.slack_webhook, JSON.stringify(json), function () {
            track.scrobbled = true;
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
        var artistTitlePresent, greaterThan30s, listenedTo4m, listenedToMoreThanHalf,
            noDurationWithElapsed, serviceEnabled;

        artistTitlePresent     = (track.artist && track.title ? true : false);
        greaterThan30s         = (track.duration > 30000);
        listenedTo4m           = (track.elapsed >= 240000);
        listenedToMoreThanHalf = (track.elapsed >= track.duration / 2);
        noDurationWithElapsed  = (!track.duration && track.elapsed > 30000);
        serviceEnabled         = getOptionStatus(track.host);

        return serviceEnabled && !track.noscrobble && artistTitlePresent && ((greaterThan30s &&
            (listenedTo4m || listenedToMoreThanHalf)) || noDurationWithElapsed);
    }

    /**
     * Updates properties in the current song object.
     *
     * @param {object} data
     */
    function updateCurrentTrack(data) {
        if (data.id === currentTrack.id) {
            keepTrackAlive();

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

        if (track.host === "youtube" && !getOptionStatus("youtube")) {
            return false;
        }

        pushTrackToHistory(track);
        keepTrackAlive();

        if (!track.artist) {
            track.editrequired = true;
            track.noscrobble   = true;
            sendMessage("trackEditRequired");
        }

        currentTrack = $.extend({}, track);
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
