const builder = require('botbuilder');
const restify = require('restify');
const moment = require('moment');
const sortJsonArray = require('sort-json-array')
const fs = require('fs');
const adldapFactory = require('adldap')()
const config = require('./lib/config.js')
const auth = require('./lib/auth.js');
const Promise = require('bluebird');
const request = require('request-promise').defaults({ encoding: null });
const https = require("https");

//=========================================================
// Function conjunction
//=========================================================

function querySNOW(queryType, queryTerm, callback) {
    var table, queryParam, returnFields

    if (queryType === 'by_tag') {
        table = 'ts_synonym_set'
        queryParam = 'synsetCONTAINS' + queryTerm
        returnFields = 'name'
    } 
    else if (queryType === 'by_service') {
        table = 'cmdb_ci_service'
        queryParam = 'name'
        returnFields = 'name,managed_by'
    }
    else if (queryType === 'by_service_details') {
        table = 'cmdb_ci_service'
        queryParam = 'nameCONTAINS' + queryTerm
        returnFields = 'name,managed_by,support_group,business_criticality,operational_status,comments'
    }

    var options = {
        uri: 'https://clayton.service-now.com/api/now/table/' + table,
        qs: {
            sysparm_query: queryParam,
            sysparm_fields: returnFields,
            sysparm_display_value: true
        },
        headers: {
            'Accept':           'application/json',
            'Content-Type':     'application/json',
            'Authorization':    auth.snow.authheader,
            'User-Agent':       'Request-Promise'
        },
        json: true 
    };
    
    request(options)
        .then(function (res) {
            console.log(res);
            callback(null, res)
        })
        .catch(function (err) {
            console.log('Oh, shit!  Request failed.')
            console.log(err)
        });
}

function getADInfo(username, callback) {
    var aduser = { sn: null, givenname: null, displayname: null, mail: null, isflagged: null, telephonenumber: null };
    var searchfilter = null;

    // determine whether we are searching for a laker id or username
    var m = username.charAt(0);
    if (isNaN(m)) 
        searchfilter = '(samaccountname=' + username + ')';
    else
        searchfilter = '(csulakerid=' + username + ')';

    var client = adldapFactory({
        searchUser: auth.user.username,
        searchUserPass: auth.user.password,
        ldapjs: {
            url: 'ldaps://ldap.clayton.edu',
            searchBase: 'dc=ccsunet,dc=clayton,dc=edu',
            scope: 'sub',
            attributes: ['dn', 'cn', 'sn', 'givenName', 'mail', 'memberOf', 'telephoneNumber', 'csuAccountFlagged', 'csuAccountFlaggedReason','displayName']
        }
    });    

    client.bind()
    .then(() => {
        client.search({ filter: searchfilter })
        .then((user) => {
            aduser.mail = user[0].mail;
            aduser.sn = user[0].sn;
            aduser.givenname = user[0].givenName;
            aduser.displayname = user[0].displayName;
            aduser.isflagged = (user[0].csuAccountFlagged !== 'TRUE') ? false : true;
            aduser.telephonenumber = user[0].telephoneNumber;
        })
        .catch((err) => console.error(err))
        .then(() => {
            client.unbind()
            callback(null, aduser)
        })
    })
    .catch((err) => console.error(err))    
}

function getChuckJoke(callback) {
    const url = 'https://api.icndb.com/jokes/random/';
    const https = require("https");
        
    https.get(url, res => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", data => {
        body += data;
      });
      res.on("end", () => {
        callback(null, body);
      });
    });
}

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
const server = restify.createServer();
server.listen(config.server.port, config.server.fqdn);
console.log('Server is listening...');

// Create chat bot
const connector = new builder.ChatConnector({
    //appId: auth.microsoft.MICROSOFT_APP_ID,
    //appPassword: auth.microsoft.MICROSOFT_APP_PASSWORD
});

const bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Dialogs
//=========================================================
const intents = new builder.IntentDialog();

bot.dialog('/', intents);
bot.dialog('/profile', [
    function (session) {
        builder.Prompts.text(session, 'Hi! What is your name?');
    },
    function (session, results) {
        session.userData.name = results.response;
        session.endDialog();
    }
]);

//=========================================================
// Intents
//=========================================================
 
intents.matches(/[get|list|show]/i, function (session) { 
    var msg = session.message.text.substr(session.message.text.indexOf(' ')).trim()
    var arg = msg.substr(msg.indexOf(' ') + 1)
    var services = ''

    // get services
    if (arg === 'services') {
        querySNOW('by_service', '', function (err, data) {
            var text = ''
            var services = data.result
    
            for (var i=0; i<services.length; i++) {
                text += "<b>" + services[i].name + "</b> (<i>" + services[i].managed_by.display_value + "</i>)<br />"
            }
    
            session.send(JSON.stringify(text))
        })
    }

    // get details <servicename>
    if (arg === 'service') {    
        var servicename = arg.substr(arg.indexOf(' ') + 1)

        querySNOW('by_service_details', servicename, function (err, data) {
            var details = ''

            details += "Service: " + data.result[0].name + "<br /> " +
                "Managed by: " + data.result[0].managed_by + "<br />" +  
                "Support Group: " + data.result[0].support_group + "<br />" +
                "Criticallity: " + data.result[0].busines_criticality + "<br />" + 
                "Status: " + data.result[0].operational_status + "<br />" +
                "Comments: " + data.result[0].comments

            session.send(details)
        })
    }   
    
    // get tag <tag>
    if (arg.startsWith("tag")) {
        var tag = arg.substr(arg.indexOf(' ') + 1)

        querySNOW('by_tag', tag, function (err, data) {
            var text = 'Business Services that match your query:<br />'
            session.send(text + data.result[0].name)           
        })
    }

    // get user <username>
    if (arg.startsWith('user')) {
        var username = arg.substr(arg.indexOf(' ') + 1)
        
        //console.log(session.message.text)
        getADInfo(username, function (err, data) {
            console.log(data);
            var userstring = "First name: " + data.givenname +
                            "<br />Last name: " + data.sn +
                            "<br />Display name: " + data.displayname +
                            "<br />E-mail: " + data.mail + 
                            "<br />Phone: " + data.telephonenumber +
                            "<br />Flagged: " + data.isflagged;

            session.send(userstring);
        }) 
    }
})

intents.matches(/help$/i, function (session) {
    session.send("Here is a list of phrases I might understand: :<p><ol><li>help</li><li>list services</li> \
        <li>get service SERVICENAME</li><li>get user _USERNAME_</li><li>get tag SEARCHTERM</li><li>chuck norris</li></ol>");
})

intents.matches(/shrug$/i, function (session) {
    session.send("¯\\\ \_(ツ) \_/¯ ");
})

intents.matches(/chuck norris$/i, function (session) {
    var stuff = '';

    getChuckJoke(function (err, data) {
        body = JSON.parse(data);
        stuff = body.value.joke;
        session.send(stuff);
    })   
})

// Request file with Authentication Header
var requestWithToken = function (url) {
	console.log('the token is' + obtainToken);
    return obtainToken().then(function (token) {
        return request({
            url: url,
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/octet-stream'
            }
        });
    });
};

// Promise for obtaining JWT Token (requested once)
var obtainToken = Promise.promisify(connector.getAccessToken.bind(connector));
