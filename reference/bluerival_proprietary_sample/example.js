'use strict';

// this runs random URLs through and tracks performance. it also illustrate
// priority queuing which allows high priority requests to preempt other already
// queued requests.

var normalTests = 100;

var async = require( 'async' );

var getTimer = function() {

	var start = new Date().getTime();

	return function( name ) {
		var stop = new Date().getTime();
		var duration = stop - start;

		if ( name ) {
			console.error( 'timer ' + name + ': ' + duration + 'ms' );
		} else {
			return duration;
		}
	};

};

var validContent = function( body ) {

	if ( typeof body !== 'string' ) {
		return false;
	}

	var size = body.length > 0;

	var content = body.match( /Current IP Address/i ) ||
								body.match( /craigslist/i ) ||
								body.match( /cars.com/i ) ||
								body.match( /div/i ) ||
								body.match( /html/i ) ||
								body.match( /css/i ) ||
								body.match( /script/i ) ||
								body.match( /google/i ) ||
								body.match( /autoist/i ) ||
								body.match( /autorader/i ) ||
								body.match( /ebay/i ) ||
								body.match( /hemmings/i );

	var errors = body.match( /ip[^\n]*blocked/i ) || body.match( /ip[^\n]*blocked/i );

	return size && content && !errors;

};

var acceptTestsCount = 0;
var luminati = require( '../lib/luminati' )( {
	acceptTest: function( state ) {

		return true;

		//acceptTestsCount++;
		//return (state.statusCode === 200 ||
		//				state.statusCode === 404 ||
		//				state.statusCode === 403) && validContent( state.body );

	}
} );

var priorityTests = 0;
var totalCount = 0;
var successCount = 0;
var failureCount = 0;
var timer = getTimer();

function generateRandomInteger( low, high ) {
	return Math.floor( (Math.random() * (high - low + 1)) + low );
}

function getUrl() {

	var urls = [
		//'http://checkip.dyndns.org/',
		'http://microsoft.com',
		'http://ebay.com',
		'http://autotrader.com',
		'http://www.hemmings.com',
		'https://www.google.com/',
		'http://google.com/',
		'http://bham.craigslist.org/ctd/' + generateRandomInteger( 50000000, 5262583218 ) + '.html',
		'http://www.craigslist.org/about/sites',
		'http://www.craigslist.org',
		'http://www.cars.com',
		'http://www.cars.com/vehicledetail/detail/' + generateRandomInteger( 40000000, 648976603 ) + '/overview/'
	];

	return urls[ generateRandomInteger( 0, urls.length - 1 ) ];
}

var percent = function( count, total, precision ) {

	precision = (typeof precision === 'number' && precision >= 0) ? precision : 1;

	var ratio = count / total;
	var percentDecimal = ratio * 100;
	var multi = Math.pow( 10, precision );
	var partial1 = multi * percentDecimal;
	var partial2 = partial1 + 0.5;
	var partial3 = Math.floor( partial2 );
	var partial4 = partial3 / multi;

	var percentString = partial4 + '';

	var decimalPart = percentString.match( /\.([0-9]*)$/ );
	if ( !decimalPart && precision > 0 ) {
		percentString += '.';
	}
	var decimalPlaces = decimalPart ? decimalPart[ 1 ].length : 0;
	var missingDecimalPlaces = Math.max( 0, precision - decimalPlaces );

	for ( var i = 0; i < missingDecimalPlaces; i++ ) {
		percentString += '0';
	}
	percentString += '%';

	return percentString;

};

var printStats = function() {

	var duration = timer();
	var speed = Math.floor( totalCount / duration * 100000 ) / 100;
	var averageDuration = Math.floor( 100 * duration / totalCount ) / 100;

	var successPercent = percent( successCount, normalTests + priorityTests );
	var failurePercent = percent( failureCount, normalTests + priorityTests );
	var attemptsPercent = percent( acceptTestsCount - successCount + failureCount, acceptTestsCount, 0 );

	console.error( 'Time:', new Date().toISOString() );
	console.error( 'run:', totalCount );
	console.error( 'success:', successCount, '(', successPercent, ')' );
	console.error( 'failure:', failureCount, '(', failurePercent, ')' );
	console.error( 'extra requests:', acceptTestsCount - successCount + failureCount, '(', attemptsPercent, ')' );
	console.error( 'average speed:', speed + ' req/s' );
	console.error( 'average duration:', averageDuration + ' ms/req' );
	console.error();

};

var statsInterval = setInterval( printStats, 5000 );

function successCheck( type, url, done ) {

	if ( typeof done !== 'function' ) {
		done = function() {
			// NO-OP
		};
	}

	var timer = setTimeout( function() {
		timer = null;

		console.error( 'slow site', url );

	}, 10000 );

	return function( err, response, body ) {

		if ( timer ) {
			clearTimeout( timer );
		} else {
			console.error( 'slow site finally finished', url );
		}

		totalCount++;
		//console.error( 'ALL BODY START', body ? body.substring( 0, 10000 ) : null, 'ALL BODY END' );
		if ( err || !validContent( body ) ) {

			//console.error( type + ': err, body', {
			//	url: url,
			//	err: err
			//}, response ? response.statusCode : null, body ? body.substring( 0, 10000 ) : JSON.stringify( body ) );

			failureCount++;
		}
		else {
			successCount++;
		}

		done();

	};

}

var priority = function() {

	var url = getUrl();

	priorityTests++;
	luminati( { url: url, priority: 99 }, successCheck( 'priority', url ) );

};

setInterval( priority, 1000 );
priority();

async.times( normalTests, function( i, done ) {

	var url = getUrl();

	luminati( url, successCheck( 'normal', url, done ) );

}, function() {
	clearInterval( statsInterval );
	printStats();
	process.exit();
} );