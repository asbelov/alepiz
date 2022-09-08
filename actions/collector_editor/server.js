/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.07.2015.
 */
var log = require('../../lib/log')(module);
var collectors = require('../../lib/collectors');
var help = require('../../lib/help');
var server = require('../../server/counterProcessor');
const Conf = require("../../lib/conf");
const confServer = new Conf('config/server.json');

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var collector = {};
    if(!args.ID) return callback(new Error('Collector ID is not set'));
    var ID = args.ID;

    if(args.deleteCollector){
        collectors.delete(ID, function(err){
            if(err) return callback(err);

            server.sendMsg({reconnectToCollectors: 1});

            log.info('Collector ', ID, ' deleted successfully');
            callback(null, ID);
        });
        return;
    }

    if(!args.name) return callback(new Error('Collector name is not set'));
    if(!args.jsEditorParent) return callback(new Error('Collector code is not set'));
    var code = args.jsEditorParent;
    collector.name = args.name;
    collector.description = args.description;
    collector.active = args.activeCollector;
    collector.separate = args.activeCollector ? '' : args.separateCollector;
    collector.runCollectorAsThread = args.runCollectorAsThread;


    collector.runCollectorSeparately = args.runCollectorSeparately;
    var maxTimeToProcessCounter = confServer.maxTimeToProcessCounter;
    if(confServer.maxTimeToProcessCounter !== parseInt(confServer.maxTimeToProcessCounter)) {
        maxTimeToProcessCounter = 30000;
    }
    if(args.runCollectorSeparately && Number(args.runCollectorSeparately) !== parseInt(args.runCollectorSeparately)) {
        collector.runCollectorAsThread = maxTimeToProcessCounter;
    }

    var parameters = {};
    for(var inputID in args) {
        if(!args.hasOwnProperty(inputID)) continue;

        var num = Number(inputID.replace(/^parameter_(\d+)_.+$/i, '$1'));
        if(num){
            if(!parameters[num]) parameters[num] = {};
            parameters[num][inputID.substring(String('parameter_' + String(num) + '_').length)] = args[inputID];
        }
    }
    log.debug('Collector parameters: ',parameters);
    collector.parameters = {};

    var parametersOrder = args.parametersOrder.split(',');
    for(var i = 0; i < parametersOrder.length; i++) {
        num = parametersOrder[i];
//    for(num in parameters) {
//        if(!parameters.hasOwnProperty(num)) continue;

        if(!parameters[num]){
            return callback(new Error('Parameter is not set'));
        }

        if(!parameters[num].name){
            return callback(new Error('Parameter name is not set'));
        }

        if(!parameters[num].name.match(/^[a-zA-Z_$][a-zA-Z0-9_$\-]+$/)){
            return callback(new Error('Parameter name has illegal symbols. It can contain Javascript variable symbols only'));
        }

        var name = parameters[num].name;
        log.debug('Initialising parameter: ', parameters[num]);

        collector.parameters[name] = {};
        if(parameters[num].description)
            collector.parameters[name].description = parameters[num].description;
        if(parameters[num].canBeEmpty)
            collector.parameters[name].canBeEmpty = parameters[num].canBeEmpty;
        if(parameters[num].checkAs)
            collector.parameters[name].checkAs = parameters[num].checkAs;
        if(parameters[num].type)
            collector.parameters[name].type = parameters[num].type;
        if(parameters[num].default) {
            // closure
            (function(name) {
                collectors.checkParameter(parameters[num].default, collector.parameters[name].checkAs, null, function (err, val) {
                    if (err) return callback(new Error('Default value for collector ' + ID + ', parameter ' + name +
                        ' is incorrect: ' + err.message));

                    collector.parameters[name].default = val;
                })
            })(name);
        }
        log.debug('Initialising parameter ', name, ' done');
    }

    log.debug('Collector ID: ', ID);
    log.debug('Collector object: ', collector);
    log.debug('Collector code: ', code);

    collectors.save(ID, collector, code, args.collectorID, function(err) {
        if(err) return callback(err);

        help.save(collectors.getCollectorPath(ID), null, args.lang, args.helpEditor, 'pug', function (err) {
            if(err) callback(err);

            if(args.restartServer) {
                log.info('Sending message to restart server for applying changes');
                server.sendMsg({restart: 1});
            } else log.warn('Changes are not applying to server, because server was not restarted');

            log.info('Collector ',ID,' (',collector.name,') added successfully');
            callback(null, ID);
        });
    });
};