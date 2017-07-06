﻿import { MetaUtils } from "../metadata/utils";
import * as Utils from "../utils";
import { Decorators } from '../constants/decorators';
import { DecoratorType } from '../enums/decorator-type';
import { IProcessControlParams } from './interfaces/IProcessControlParams';
import { IProcessControlService, processControlServiceName } from './interfaces/IProcessControlService';
import * as Enumerable from 'linq';
import {executeWorkerHandler} from './workerAssociation';
import {Container} from '../../di';
import Q = require('q');

//This function is a private function and not exposed as an attribute
//process type=1 process_start
//process type=2 processend
//process type=3 processstart and end
function preProcessHandler(params: IProcessControlParams, target, propertyKey, descriptor, originalMethod, type: string) {
    return function () {
        var meta = MetaUtils.getMetaData(target, type, propertyKey);
        var targetObjectId: any;
        if (params.indexofArgumentForTargetObjectId != undefined) {
            targetObjectId = arguments[params.indexofArgumentForTargetObjectId];
        }

        if (params.indexofArgumentForTargetObject != undefined) {
            targetObjectId = arguments[params.indexofArgumentForTargetObject]._id;
        }

        var services = MetaUtils.getMetaDataForDecorators([Decorators.SERVICE]);
        var procService = Enumerable.from(services).where(x => x.metadata[0].params.serviceName == processControlServiceName).select(x => x.metadata[0]).firstOrDefault();
        if (!procService)
            return originalMethod.apply(this, arguments);

        var processControlService: IProcessControlService = <IProcessControlService>Container.resolve(procService.params.target);
        var targetServices = MetaUtils.getMetaData(target, Decorators.SERVICE);
        var serviceName = targetServices[0].params.serviceName;
        if (processControlService && meta) {
            if (type == Decorators.PROCESS_START || type == Decorators.PROCESS_START_AND_END) {
                //preprocess
                let argsObj = Utils.getMethodArgs(originalMethod, arguments);
                
                if (params.executeInWorker && !MetaUtils.childProcessId) {
                    // Parent - processcontrol management executing with worker 
                    var taskInfo = executeWorkerHandler({}, target, propertyKey, originalMethod, Decorators.WORKER).apply(this, arguments);
                    console.log('process initialized started');
                    return processControlService.initialize(serviceName, propertyKey, targetObjectId, params.type, params.action, argsObj, taskInfo).then((sucess) => {
                        console.log('process initialized started successfully');
                        return processControlService.sendResponse(sucess, taskInfo);
                    });
                }
                else {
                    let initialize;
                    if (params.executeInWorker && MetaUtils.childProcessId) {
                        // already initialized in parent process
                        initialize = Q.when(true);
                        console.log('process already initialized');
                    }
                    else {
                        console.log('process initialized started');
                        initialize = processControlService.initialize(serviceName, propertyKey, targetObjectId, params.type, params.action, argsObj);
                    }
                    return initialize.then(res => {
                        return processControlService.startProcess(serviceName, propertyKey, targetObjectId, params.type, params.action).then((sucess) => {
                            console.log('process started');
                            if (sucess) {
                                //actual method of caller
                                var result = originalMethod.apply(this, arguments);
                                if (Utils.isPromise(result)) {
                                    console.log('process method executed');
                                    return result.then((sucess) => {
                                        if (type == Decorators.PROCESS_START_AND_END) {
                                            //return statement
                                            return processControlService.completeProcess(serviceName, propertyKey, targetObjectId, params.type, params.action).then((result) => {
                                                console.log('process completed');    
                                                return sucess;
                                            });
                                        } else {
                                            return sucess;
                                        }
                                    }, (error) => {
                                        if (type == Decorators.PROCESS_START_AND_END) {
                                            //return statement
                                            return processControlService.errorOutProcess(serviceName, propertyKey, targetObjectId, params.type, params.action, JSON.stringify(error)).then((result) => {
                                                console.log('process error');
                                                throw error;
                                            }).catch((err) => {
                                                console.log('process error');
                                                throw error;
                                            })
                                        } else {
                                            throw error;
                                        }
                                    });
                                }
                                else {
                                    if (type == Decorators.PROCESS_START_AND_END) {
                                        //return statement
                                        console.log('process method executed');
                                        return processControlService.completeProcess(serviceName, propertyKey, targetObjectId, params.type, params.action).then(res => {
                                            console.log('process completed');
                                            return result;
                                        });
                                    }
                                }
                            }
                            else {
                                return Promise.reject("already running process");
                            }
                        }, (error) => {
                            return Promise.reject("Error while starting process : " + error);
                        });
                    });
                }
            }
            if (type == Decorators.PROCESS_END) {
                var result = originalMethod.apply(this, arguments);
                if (Utils.isPromise(result)) {
                    return result.then((sucess) => {
                        return processControlService.completeProcess(serviceName, propertyKey, targetObjectId, params.type, params.action).then((result) => {
                            return sucess;
                        });
                    }, (error) => {
                        return processControlService.errorOutProcess(serviceName, propertyKey, targetObjectId, params.type, params.action, JSON.stringify(error)).then((result) => {
                            throw error;
                        }).catch((err) => {
                            throw error;
                        });
                    });
                } else {
                    processControlService.completeProcess(serviceName, propertyKey, targetObjectId, params.type, params.action);
                    return result;
                }
            }
            return descriptor;
        }
        else {
            return originalMethod.apply(this, arguments);
        }
    };
}

export function processStart(params: IProcessControlParams): any {
    params = params || <any>{};

    return function (target: Function, propertyKey: string, descriptor: any) {
        MetaUtils.addMetaData(target,
            {
                decorator: Decorators.PROCESS_START,
                decoratorType: DecoratorType.METHOD,
                params: params,
                propertyKey: propertyKey
            });
        var origianlmethod = descriptor.value;
        descriptor.value = preProcessHandler(params, target, propertyKey, descriptor, origianlmethod, Decorators.PROCESS_START);
        //descriptor.value = preProcessHandler(params, target, propertyKey, descriptor, rsProcessDecorators.PROCESS_START);
    }
}
export function processEnd(params: IProcessControlParams): any {
    params = params || <any>{};

    return function (target: Function, propertyKey: string, descriptor: any) {
        MetaUtils.addMetaData(target,
            {
                decorator: Decorators.PROCESS_END,
                decoratorType: DecoratorType.METHOD,
                params: params,
                propertyKey: propertyKey
            });

        var origianlmethod = descriptor.value;
        descriptor.value = preProcessHandler(params, target, propertyKey, descriptor, origianlmethod, Decorators.PROCESS_END);
        //descriptor.value = preProcessHandler(params, target, propertyKey, descriptor, rsProcessDecorators.PROCESS_END);
    }
}
export function processStartEnd(params: IProcessControlParams): any {
    params = params || <any>{};

    return function (target: Function, propertyKey: string, descriptor: any) {
        MetaUtils.addMetaData(target,
            {
                decorator: Decorators.PROCESS_START_AND_END,
                decoratorType: DecoratorType.METHOD,
                params: params,
                propertyKey: propertyKey
            });

        var origianlmethod = descriptor.value;
        descriptor.value = preProcessHandler(params, target, propertyKey, descriptor, origianlmethod, Decorators.PROCESS_START_AND_END);
    }

}

