﻿import {getEntity} from '../dynamic/model-entity';
import * as utils from "../utils";
import {MetaData} from '../metadata/metadata';
import {IAssociationParams} from '../decorators/interfaces';
var Enumerable: linqjs.EnumerableStatic = require('linq');

export class InstanceService {

    static getInstance(entity: any, id: any, param: any) {
        if (id) {
            var meta = utils.getPrimaryKeyMetadata(entity);
            if (meta) {
                param[meta.propertyKey] = id;
            }
        }
        InstanceService.initProperties(entity, param, true);
        return InstanceService.getInstanceFromType(entity, true, param);
    }

    static getObjectFromJson(entity: any, param?: any) {
        InstanceService.initProperties(entity, param, false);
        return InstanceService.getInstanceFromType(entity, false, param);
    }

    private static getInstanceFromType(type: any, isNew: boolean, param?: any) {
        var t: (param) => void = type.constructor;
        return InstanceService.createObjectInstance(t, isNew, param);
    }

    private static createObjectInstance(t: any, isNew: boolean, param?: any) {
        if (isNew) {
            return InstanceService.getNewInstance(t, param);
        }
        else {
            return InstanceService.getExistingInstance(t, param);
        }
    }

    private static getNewInstance(t: any, param?: any) {
        // This invokes constructor of the object
        var newInstance = new t(param);
        if (param) {
            for (var prop in param) {
                newInstance[prop] = param[prop];
            }
        }
        return newInstance;
    }

    private static getExistingInstance(t: any, param?: any) {
        // No constructir is invoked
        var existingInstance = Object.create(t);
        if (param) {
            for (var prop in param) {
                existingInstance[prop] = param[prop];
            }
        }
        return existingInstance;
    }

    private static initProperties(type: any, param: any, isNew: boolean) {
        var metas = utils.getAllRelationsForTargetInternal(type);
        if (metas) {
            metas.forEach(x => {
                let meta = <MetaData>x;
                let p = <IAssociationParams>meta.params;
                if (param[meta.propertyKey]) {
                    var value = param[meta.propertyKey];
                    if (meta.propertyType.isArray) {
                        if (value.length > 0 && utils.isJSON(value[0])) {
                            var res = [];
                            Enumerable.from(value).forEach(x => {
                                res.push(InstanceService.createObjectInstance(p.itemType, isNew, x));
                            });
                            param[meta.propertyKey] = res;
                        }
                    }
                    else {
                        if (utils.isJSON(value)) {
                            param[meta.propertyKey] = InstanceService.createObjectInstance(p.itemType, isNew, value);
                        }
                    }
                }
            });
        }
    }
}