'use strict';

// this is the sample high performance usage from luminati.io website

var request = require( 'request-promise' );
var promise = require( 'bluebird' ); // promises lib used by request-promise
var http = require( 'http' );
var username = 'lum-customer-autoist-zone-gen';
var password = 'bd06f60064b5';
var port = 22225;
var user_agent = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2228.0 Safari/537.36';
var at_req = 0;
var n_total_req = 1000;
var n_parallel_exit_nodes = 100;
var switch_ip_every_n_req = 50;
var max_failures = 3;
var req_timeout = 60 * 1000;

function main() {
	http.Agent.defaultMaxSockets = Infinity;
	for ( var i = 0; i < n_parallel_exit_nodes; i++ ) {
		new Session( i ).start();
	}
}

function Session( id ) {
	this.id = id;
	this.n_req_for_exit_node = 0;
	this.fail_count = 0;
	this.switch_session_id();
}

Session.prototype.start = Session.prototype.next = function() {
	if ( at_req >= n_total_req ) {
		return this.cleanup();
	} // all done
	at_req++;
	var _this = this;
	promise.try( function() {
		if ( !_this.have_good_super_proxy() ) {
			return _this.get_super_proxy();
		}
	} ).then( function() {
		if ( _this.n_req_for_exit_node == switch_ip_every_n_req ) {
			_this.switch_session_id();
		}
		var options = {
			url:     'http://bham.craigslist.org/search/cto',
			timeout: req_timeout,
			pool:    _this.pool,
			proxy:   _this.super_proxy_url,
			headers: { 'User-Agent': user_agent },
		};
		return request( options );
	} ).then( function success( res ) {
		console.log( res );
		_this.fail_count = 0;
		_this.n_req_for_exit_node++;
	}, function error( err ) {
		if ( err.statusCode && !status_code_requires_exit_node_switch( err.statusCode ) ) {
			// this could be 404 or other website error
			_this.n_req_for_exit_node++;
			return;
		}
		_this.switch_session_id();
		_this.fail_count++;
	} ).finally( function() {
		_this.next();
	} );
};

Session.prototype.have_good_super_proxy = function() {
	return this.super_proxy_url && this.fail_count < max_failures;
};

Session.prototype.get_super_proxy = function() {
	var _this = this;
	return request( 'http://client.luminati.io/api/get_super_proxy?raw=1&user=' + username + '&key=' + password )
		.then( function( ip ) {
			_this.super_proxy_ip = ip;
			_this.update_super_proxy_url();
		} );

};

Session.prototype.switch_session_id = function() {
	connection_pool_cleanup( this.pool );
	this.pool = {};
	this.session_id = Math.random();
	this.n_req_for_exit_node = 0;
	if ( this.super_proxy_ip ) {
		this.update_super_proxy_url();
	}
};

Session.prototype.update_super_proxy_url = function() {
	this.super_proxy_url = 'http://' + username + '-country-us-dns-remote-session-' + this.session_id +
						   ':' + password + '@' + this.super_proxy_ip + ':' + port;
};

Session.prototype.cleanup = function() {
	connection_pool_cleanup( this.pool );
};

function connection_pool_cleanup( pool ) {
	if ( !pool ) {
		return;
	}
	Object.keys( pool ).forEach( function( key ) {
		var sockets = pool[ key ].sockets;
		Object.keys( sockets ).forEach( function( name ) {
			sockets[ name ].forEach( function( s ) {
				s.destroy();
			} );
		} );
	} );
}

function status_code_requires_exit_node_switch( status_code ) {
	return status_code in [ 403, 429, 502, 503 ];
}

main();