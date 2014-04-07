/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName    = 'search'

var _             = require('underscore');
var assert        = require('assert');
var async         = require('async');
var elasticsearch = require('elasticsearch');
var ejs           = require('elastic.js');

function search(options, register) {
  var options = options || {};
  var seneca = this;

  // Apply defaults individually,
  // instead of all-or-nothing.
  var connectionOptions = options.connection || {};

  _.defaults(connectionOptions, {
    host          : 'localhost:9200',
    sniffInterval : 300000,
    index         : 'seneca',
    sniffOnStart  : true,
    log           : 'error'
  });

  var esClient = new elasticsearch.Client(connectionOptions);

  /**
  * Seneca bindings.
  *
  * We compose what needs to happen during the events
  * using async.seq, which nests the calls the functions
  * in order, passing the same context to all of them.
  */

  // index events
  seneca.add({role: pluginName, cmd: 'create-index'}, ensureIndex);

  seneca.add({role: pluginName, cmd: 'has-index'}, hasIndex);

  seneca.add({role: pluginName, cmd: 'delete-index'},
    async.seq(ensureIndex, deleteIndex));

  // data events
  seneca.add({role: pluginName, cmd: 'save'},
    async.seq(ensureIndex, populateRequest,
      populateBody, saveRecord));

  seneca.add({role: pluginName, cmd: 'load'},
    async.seq(ensureIndex, populateRequest, loadRecord));

  seneca.add({role: pluginName, cmd: 'search'},
    async.seq(ensureIndex, populateRequest,
      populateSearch, populateSearchBody, doSearch));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(ensureIndex, populateRequest, removeRecord));

  // entity events
  seneca.add({role:'entity',cmd:'save'},
    async.seq(populateCommand, entitySave, entityAct));

  seneca.add({role:'entity',cmd:'remove'},
    async.seq(populateCommand, entityRemove, entityAct));

  register(null, {
    name: pluginName,
    native: esClient
  });

  /*
  * Entity management
  */
  function entitySave(args, cb) {
    args.command.cmd = 'save';
    args.command.data = args.ent.data$();

    // TODO: _.pick only the specified keys
    cb(null, args);
  }

  function entityRemove(args, cb) {
    var prior = this.prior.bind(this);

    args.command.cmd = 'remove';
    args.command.data = { id: args.ent.id };
    cb(null, args);
  }

  function entityAct(args, cb) {
    assert(args.command, "missing args.command");

    var prior = this.prior.bind(this);
    seneca.act( args.command, function( err ) {
      if(err) { return seneca.fail(err); }
      prior(args, cb);
    });
  }

  /*
  * Index management.
  */
  function hasIndex(args, cb) {
    esClient.indices.exists({index: args.index}, cb);
  }

  function createIndex(args, cb) {
    esClient.indices.create({index: args.index}, cb);
  }

  function deleteIndex(args, cb) {
    esClient.indices.delete({index: args.index}, cb);
  }

  // creates the index for us if it doesn't exist.
  function ensureIndex(args, cb) {
    hasIndex(args, onExists);

    function onExists(err, exists) {
      if (err || !exists) {
        createIndex(args, passArgs(args, cb));
      } else {
        cb(err, args);
      }
    }
  }

  /**
  * Record management.
  */
  function saveRecord(args, cb) {
    esClient.index(args.request, cb);
  }

  function loadRecord(args, cb) {
    esClient.get(args.request, cb);
  }

  function removeRecord(args, cb) {
    esClient.delete(args.request, cb);
  }

  function doSearch(args, cb) {
    esClient.search(args.request, cb);
  }

  /**
  * Constructing requests.
  */

  function populateCommand(args, cb) {
    args.entityData = args.ent.data$();
    args.command = {
      role  : pluginName,
      index : connectionOptions.index,
      type  : args.entityData.entity$.name,
    }

    cb(null, args);
  }

  function populateBody(args, cb) {
    args.request.body = args.data;
    cb(null, args);
  }

  function populateSearch(args, cb) {
    var defaultSearch = ejs.Request()
      .query(ejs.MatchAllQuery());

    args.searchRequest = args.search || defaultSearch;

    cb(null, args);
  }

  function populateSearchBody(args, cb) {
    args.request.body = args.searchRequest;
    cb(null, args);
  }

  function populateRequest(args, cb) {
    assert.ok(args.data, 'missing args.data');

    var dataType = args.type || args.data.entity$;
    assert.ok(dataType, 'expected either "type" or "data.entity$" to deduce the entity type');

    args.request = {
      index: args.index,
      type: dataType,
      id: args.data.id,
      refresh: options.refreshOnSave,
    };

    cb(null, args);
  }

  // ensures callback is called consistently
  function passArgs(args, cb) {
    return function (err, resp) {
      if (err) { console.error(err); }

      cb(err, args);
    }
  }

}

module.exports = search;
