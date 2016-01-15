'use strict';

// this is BlueRival's proprietary code. it automatically rotates sessions,
// super proxies, locks to US based super proxies and does exit node DNS
// lookups. it has automatic retry logic which uses a user defined function
// for testing if the returned response was valid or blocked by the target
// site.

var __ = require( 'doublescore' );
var ASC = require( 'asc' );
var async = require( 'async' );
var net = require( 'net' );
var request = require( 'request' );

var proxyHistory = [];
var proxyHistoryLookup = {};

var username = '******';
var password = '******';

// proxies and sessions used globally
var maxSession = 1000;
var nextSession = generateRandomInteger( 0, maxSession );
var sessionOffset = null;
var sessionCount = 0;

var parallelRequests = 500; // running more or less than this seems to result in fewer successful req/s

var resetSessionOffset = function() {
	sessionOffset = generateRandomInteger( 0, 1000000000 );
};
resetSessionOffset();

function generateRandomInteger( low, high ) {
	return Math.floor( (Math.random() * (high - low + 1)) + low );
}

function getRandomProxyFromHistory() {

	var count = 0;

	while ( count++ < proxyHistory.length ) {

		let ip = proxyHistory[ generateRandomInteger( 0, proxyHistory.length - 1 ) ];

		if ( proxyHistoryLookup.hasOwnProperty( ip ) ) {
			return ip;
		}

	}

	return null;
}

function pushProxyHistoryEntry( ip ) {

	if ( Array.isArray( ip ) ) {
		ip.forEach( pushProxyHistoryEntry );
		return;
	}

	// if the IP is new, push it
	if ( !proxyHistoryLookup.hasOwnProperty( ip ) ) {
		proxyHistory.push( ip );
		proxyHistoryLookup[ ip ] = true;
	}

	// if too many IPs expire one
	if ( proxyHistory.length > 5000 ) {
		expireProxyHistoryEntry();
	}

}

function clearProxy( ip ) {
	if ( ip ) {
		delete proxyHistoryLookup[ ip ];
	}
}

function expireProxyHistoryEntry() {

	while ( proxyHistory.length > 0 ) {
		let ip = proxyHistory.shift() || null;

		if ( ip ) {
			delete proxyHistoryLookup[ ip ];
			return ip;
		}

	}

	return null;

}

var getSession = function() {

	sessionCount++;

	if ( sessionCount > 100 ) {
		sessionCount = 0;
		resetSessionOffset();
	}

	// make sure we have a fresh session
	nextSession++;
	if ( nextSession > maxSession ) {
		nextSession = generateRandomInteger( 0, Math.floor( maxSession * 0.1 ) );
	}

	return nextSession + sessionOffset;

};

var fs = require( 'fs' );

var userAgents = JSON.parse( fs.readFileSync( __dirname + '/userAgents.json' ) );

var getUserAgent = function() {
	return userAgents[ generateRandomInteger( 0, userAgents.length - 1 ) ];
};

var failureRate = 0;

var getProxyListCache = new ASC( {
	ttl:    30000,
	update: function( key, done ) {

		var url = 'http://client.luminati.io/api/get_super_proxy?format=json&limit=10000&raw=1&country=us&user=' + username + '-gen&key=' + password;

		request( {
			url:     url,
			timeout: 15000
		}, function( err, response, body ) {

			var proxyIps = [];

			if ( err || !body ) {
				return done( proxyIps );
			}

			try {
				proxyIps = JSON.parse( body ).proxies || [];
			} catch ( e ) {
				// NO-OP
			}

			filterProxyIps( proxyIps, done );

		} );

	}
} );

var filterProxyIpCache = new ASC( {
	ttl:    30000,
	update: function( ip, done ) {

		var doned = false;
		var _done = function( keep ) {

			if ( doned ) {
				return;
			}
			doned = true;

			keep = !!keep;

			if ( !keep ) {
				clearProxy( ip );
			}

			return done( keep );

		};

		var socket = net.connect( 22225, ip, function() {
			_done( true );
			socket.end();
		} );

		socket.setTimeout( 10000 );

		socket.on( 'error', function() {
			_done( false );
		} );

		socket.on( 'timeout', function() {
			_done( false );
		} );

		setTimeout( function() {
			socket.destroy( 'the error' );
		}, 6000 );

	}
} );

function filterProxyIps( ips, done ) {

	if ( !Array.isArray( ips ) ) {
		ips = [ ips ];
	}

	async.filter( ips, function( ip, done ) {
		filterProxyIpCache.get( ip, done );
	}, done );

}

function getProxy( zone, done ) {

	if ( !zone ) {
		zone = 'gen';
	}

	if ( typeof done !== 'function' ) {
		done = function() {
			// NO-OP
		};
	}

	var _done = function( ips ) {

		var url = null;

		// if ips was found, add it to history and use it. otherwise pull one from history
		if ( ips ) {
			pushProxyHistoryEntry( ips );
		}

		var proxyIpToUse = getRandomProxyFromHistory();

		// if we got an IP, generate the proxy url
		if ( proxyIpToUse ) {

			url = 'http://' + username + '-' + zone + '-country-us-session-' + getSession() + ':' + password + '@' + proxyIpToUse + ':22225';

		} else {
			url = null;
		}

		setTimeout( function() {
			done( null, url );
		}, url ? 0 : 5000 );

	};

	if ( proxyHistory.length >= 50 ) {
		return _done( null );
	}

	getProxyListCache.get( null, _done );

}

setImmediate( getProxy );

var concurrent = 0;
var requestQueueLuminati = async.priorityQueue( function( options, done ) {

	getProxy( options.zone || 'gen', function( err, proxyUrl ) {

		if ( !proxyUrl ) {
			done( new Error( 'no proxy available' ) );
			return;
		}

		options = __( {
			proxy:   proxyUrl,
			headers: {
				Accept:            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Cache-Control':   'max-age=0',
				'User-Agent':      getUserAgent()
			}
		} ).mixin( options );

		delete options.zone;

		concurrent++;

		request( options, function( err, response, body ) {
			concurrent--;
			done( err, response, body );
		} );

	} );

}, parallelRequests );

setInterval( function() {
	nextSession = generateRandomInteger( 0, maxSession );
	expireProxyHistoryEntry();
}, 30000 );

module.exports = function( options ) {

	var acceptTestMethod = typeof options.acceptTest === 'function' ? options.acceptTest : function() {
		return true; // approve all requests
	};

	return function( options, done ) {

		if ( typeof options === 'string' ) {
			options = {
				url: options
			};
		}

		var count = 0;
		var lastResponse = null;

		var getCallback = function( done ) {

			return function( err, response, body ) {

				count++;
				lastResponse = arguments;

				// retry next call if err, no response, or user supplied test method returns true
				if ( err || !response || !acceptTestMethod( { err: err, statusCode: response ? response.statusCode : null, body: body } ) ) {
					// proxy failed, try again
					setImmediate( done );
				} else {

					// if just one request succeeds, then reset failure rate
					failureRate = 0;

					// don't retry, success or user decided not to continue
					setImmediate( done, arguments );
				}

			};

		};

		var retryTimeouts = __( (Array.isArray( options.retryTimeouts ) && options.retryTimeouts.length > 0 ) ? options.retryTimeouts : [ 5000, 10000, 15000 ] ).clone();
		retryTimeouts.push( false );

		var priority = options.priority || 100;
		delete options.priority;
		async.eachSeries( retryTimeouts, function( timeout, done ) {

				// exhausted all attempts
				if ( timeout === false ) {
					failureRate++;
					return done( lastResponse );
				}

				options.timeout = timeout;

				setImmediate( function() {
					requestQueueLuminati.push( options, priority, getCallback( done ) );
				} );

			},
			function( result ) {
				var self = this;
				setImmediate( function() {
					done.apply( self, result );
				} );
			} );

	};

};