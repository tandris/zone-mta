module.exports.title = 'naga-sender';

const http = require('http');

let senderToken;
let nagaMainUser;
let nagaMainHost;
let nagaMainProtocol;
let nagaMainPort;

module.exports.init = function(app, done) {
    console.info('nagaMail sender plugin loaded.');
    senderToken = app.config.token;
    nagaMainHost = app.config.nagaMainHost;
    nagaMainUser = app.config.nagaMainUser;
    if (!senderToken || !nagaMainHost || !nagaMainUser) {
        throw new Error('Sender token not defined in config.');
    }

    console.info('nagaMail initialized. { mainUrl = ' + nagaMainHost + ' ; token = ' + senderToken + ' }');

    nagaMainProtocol = nagaMainHost.split('://')[0] + ':';
    nagaMainPort = nagaMainHost.split(':').length > 2 ? nagaMainHost.split(':')[2] : 80;
    nagaMainHost = nagaMainHost.split('://')[1].split(':')[0];

    app.addHook('api:mail', authorize);
    app.addHook('queue:bounce', onBounce);
    app.addHook('message:queue', onQueue);
    app.addHook('naga:defer', onDefer);
    app.addHook('naga:sent', onSent);

    heartbeat();
    setInterval(heartbeat, 60000);
    done();
};

function authorize(envelope, session, next) {
    if (session.user === nagaMainUser) {
        next();
    } else {
        console.log(session);
        let err = new Error('Invalid password');
        err.responseCode = 535;
        next(err);
    }
}

function onQueue(envelope, messageInfo, next) {
    sendEvent(parseMessageId(messageInfo['message-id']), 'PROCESSED', '');
    next();
}

function onBounce(bounce, maildrop, next) {
    let messageId = bounce.headers.getFirst('message-id');
    sendEvent(parseMessageId(messageId), 'BOUNCE', bounce.category);
    next();
}

function onDefer(zone, delivery, meta, next) {
    sendEvent(parseMessageId(meta.messageId), 'DEFERRED', delivery._deferred.response);
    next();
}

function onSent(zone, data, meta, next) {
    if (data.status.delivered === true) {
        sendEvent(parseMessageId(meta.messageId), 'DELIVERED', '');
    }
    next();
}

function parseMessageId(messageId) {
    if (messageId.indexOf('<') > -1) {
        return messageId.substr(messageId.indexOf('<') + 1, messageId.indexOf('>') - 1);
    }
    return messageId;
}

function sendEvent(messageId, eventType, eventMessage) {
    console.info('Sending message event. { eventType = ' + eventType + ',  messageId = ' + messageId + ', message = ' + eventMessage + ' }');
    let req = http.request({
        host: nagaMainHost,
        protocol: nagaMainProtocol,
        port: nagaMainPort,
        path: '/api/sender/unit/add_message_event',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Auth-Token': senderToken
        },
        agent: false // create a new agent just for this one request
    }, (res) => {
        res.on("data", function(chunk) {
            let result = JSON.parse(chunk);
            console.log(result);
        });
    });
    req.on('error', function(err) {
        console.error('Failed to send event request.');
        console.log(err);
    });
    req.end();
}

function heartbeat() {
    let req = http.request({
        host: nagaMainHost,
        protocol: nagaMainProtocol,
        port: nagaMainPort,
        path: '/api/sender/unit/heartbeat',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Auth-Token': senderToken
        },
        agent: false // create a new agent just for this one request
    }, (res) => {
        res.on("data", function(chunk) {
            let result = JSON.parse(chunk);
            if (result !== true) {
                console.error('Failed to send heartbeat to naga main server.');
                console.error(result);
            }
        });
    });
    req.on('error', function(err) {
        console.error('Failed to send heartbeat request to server.');
        console.log(err);
    });
    req.end();
}
