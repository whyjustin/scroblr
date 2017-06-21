"use strict";

var firefox = {
    isFirefox: typeof self != "undefined" && 
                typeof chrome == "undefined" &&
                typeof safari == "undefined",

    // popup receives this data in a message from the background page
    state: {
        currentTrack: null,
        history: []
    },

    scroblrGlobal: {
        getCurrentTrack: function () {
            return firefox.state.currentTrack;
        },
        
        getHistory: function () {
            return firefox.state.history;
        },

        messageHandler: function(o) {
            firefox.postMessage(o);
        }
    },
    
    postMessage: function(message) {
        // send currentTrack, history, session from background page to popup
        if (typeof window.scroblrGlobal != "undefined") {
            var state = {
                currentTrack: window.scroblrGlobal.getCurrentTrack(),
                history: window.scroblrGlobal.getHistory()
            };

            self.postMessage({name: 'state', message: state});
        }

        self.postMessage(message);
    },

    addEventListener: function(listener) {
        if (typeof self.on == "undefined") {
            return;
        }

        self.on("message", function(message) {
            // receive state from background page
            if (message.name === "state") {
                firefox.state = message.message;
                return;
            }

            listener(message);
        });
    },
    
    openTab: function(url) {
        firefox.postMessage({name: "openTab", message: url});
    },
    
    showNotification: function(options) {
        firefox.postMessage({name: "showNotification", message: options});
    }
};

if (firefox.isFirefox) {
    module.exports = firefox;
} else {
    module.exports = false;
}
