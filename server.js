var config = require('./config.js');

var fs = require('fs');
var dns = require('native-dns');


var cache = require('memory-cache');

// load hosts into cache
if (config.usehosts) {
    fs.readFile('./custom/hosts', {encoding: 'utf8'}, function(err, data) {
        var hosts = data.split("\n");
        hosts.forEach(function(host) {
            if (!host.startsWith("#") && host !== '') {
                host = host.replace(/\s+|\t/g, '|').split('|');
                cache.put(host[1], {type: 'A', data: [host[0]]});
            }
        });
    });
}

// load blacklist into memory
var blacklist = [];
if (config.useblacklist) {
    fs.readFile('./custom/blacklist', {encoding: 'utf8'}, function(err, data) {
        var blist = data.split("\n");
        blist.forEach(function(ip) {
            if (!ip.startsWith("#") && ip !== '') {
                blacklist.push(ip);
            }
        });
    });
}

// functions

function dnsserv(request, response) {
    var name = request.question[0].name,
        type = dns.consts.qtypeToName(request.question[0].type),
        sourceIP = request.address.address;

    var result = cache.get(name);
    if (result && (result.type === type || ((type === 'A' || 'AAAA') && result.type === 'CNAME'))) {

        sendresponse(response, name, result.type, result.data, result.ttl ? result.ttl - now() + result.updateTime : 0, result.prio);

    }
}

function randomOrder() {
    return (Math.round(Math.random()) - 0.5);
}

// ttl: result.ttl ? result.ttl - now() + result.updateTime : 0
function sendresponse(response, name, type, data, ttl, prio) {
    switch (type) {
        case "A":
            data.sort(randomOrder());
            data.forEach(function(recdata) {
                response.answer.push(dns.A({
                    name: name,
                    address: recdata,
                    ttl: ttl || 0
                }));
            });
            break;
        case "AAAA":
            data.sort(randomOrder());
            data.forEach(function(recdata) {
                response.answer.push(dns.AAAA({
                    name: name,
                    address: recdata,
                    ttl: ttl || 0
                }));
            });
            break;
        case "CNAME":
            data.sort(randomOrder());
            data.forEach(function(recdata) {
                response.answer.push(dns.CNAME({
                    name: name,
                    data: recdata,
                    ttl: ttl || 0
                }));
            });
            break;
        case "MX":
            data.sort(randomOrder());
            data.forEach(function(recdata) {
                response.answer.push(dns.MX({
                    name: name,
                    priority: prio,
                    exchange: recdata,
                    ttl: ttl || 0
                }));
            });
            break;

    }
    response.send();
}

function now() {
    return Math.floor((new Date).getTime()/1000);
}

function exitError(err) {
    console.log('Error detected:\n' + err + '\nWill now exit.');
    process.exit(1);
}

// http://stackoverflow.com/questions/646628/how-to-check-if-a-string-startswith-another-string
if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str){
        return this.slice(0, str.length) == str;
    };
}
if (typeof String.prototype.endsWith != 'function') {
    String.prototype.endsWith = function (str){
        return this.slice(-str.length) == str;
    };
}



// process

var cluster = require('cluster');
var numCPUs = require('os').cpus().length;


if (cluster.isMaster) {
    console.log("Starting master process...");

    // Fork workers.
    for (var i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    /*
     cluster.on('listening', function(worker, address){
     console.log('listening: worker ' + worker.process.pid + ', Address: ' + address.address + ":" + address.port);
     });

     cluster.on('exit', function(worker, code, signal) {
     console.log('worker ' + worker.process.pid + ' exited.');
     });*/
} else {

// Start servers
    var UDPserver = dns.createServer({ dgram_type: 'udp4' });
    UDPserver.serve(config.port);

// TCP server
    if (config.enableTCP) {
        var TCPserver = dns.createTCPServer();
        if (config.enableV6) {
            TCPserver.serve(config.port, '::');
        } else {
            TCPserver.serve(config.port);
        }
    }

// IPv6
    if (config.enableV6) {
        var UDPserver6 = dns.createUDPServer({ dgram_type: 'udp6' });
        UDPserver6.serve(config.port);
    }

    console.log('DNS Server started at port ' + config.port + '.');

// Query events...
    UDPserver.on('request', dnsserv);
    UDPserver6.on('request', dnsserv);
    TCPserver.on('request', dnsserv);

    UDPserver.on('error', function (err, buff, req, res) {
        console.log('UDP Server ERR:\n');
        console.log(err);
    });
    UDPserver6.on('error', function(err, buff, req, res) {
        console.log('UDP6 Server ERR:\n');
        console.log(err);
    });
    TCPserver.on('error', function (err, buff, req, res) {
        console.log('TCP Server ERR:\n');
        console.log(err);
    });

}