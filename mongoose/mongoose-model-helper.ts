﻿import Mongoose = require("mongoose");
import Q = require('q');
import {EntityChange} from '../core/enums/entity-change';
import {MetaUtils} from "../core/metadata/utils";
import * as CoreUtils from "../core/utils";
import * as Utils from "./utils";
import {Decorators} from '../core/constants/decorators';
import {DecoratorType} from '../core/enums/decorator-type';
import {MetaData} from '../core/metadata/metadata';
import {IAssociationParams} from '../core/decorators/interfaces';
import {IFieldParams, IDocumentParams} from './decorators/interfaces';
import {GetRepositoryForName} from '../core/dynamic/dynamic-repository';
import {getEntity, getModel} from '../core/dynamic/model-entity';
var Enumerable: linqjs.EnumerableStatic = require('linq');
import {winstonLog} from '../logging/winstonLog';
import * as mongooseModel from './mongoose-model';

/**
 * finds all the parent and update them. It is called when bulk objects are updated
 * @param model
 * @param objs
 */
export function updateParent(model: Mongoose.Model<any>, objs: Array<any>) {
    var allReferencingEntities = CoreUtils.getAllRelationsForTarget(getEntity(model.modelName));
    var asyncCalls = [];
    Enumerable.from(allReferencingEntities)
        .forEach((x: MetaData) => {
            var param = <IAssociationParams>x.params;
            if (param.embedded) {
                var meta = MetaUtils.getMetaData(x.target, Decorators.DOCUMENT);
                var targetModelMeta = meta[0];
                var repoName = (<IDocumentParams>targetModelMeta.params).name;
                var model = getModel(repoName);
                asyncCalls.push(updateParentDocument(model, x, objs));
            }
        });
    return Q.allSettled(asyncCalls);
}

/**
 * This removes all the transient properties.
 * @param model
 * @param obj
 */
export function removeTransientProperties(model: Mongoose.Model<any>, obj: any): any {
    var clonedObj = {};
    Object.assign(clonedObj, obj);
    var transientProps = Enumerable.from(MetaUtils.getMetaData(getEntity(model.modelName))).where((ele: MetaData, idx) => {
        if (ele.decorator === Decorators.TRANSIENT) {
            return true;
        }
        return false;
    }).forEach(element => {
        delete clonedObj[element.propertyKey];
    });
    return clonedObj;
}

/**
 * For eagerLoading, finds all the children and add this to the parent object.
 * This function is then recursively called to update all the embedded children.
 * @param model
 * @param val
 * @param force
 */
export function embeddedChildren(model: Mongoose.Model<any>, val: any, force: boolean) {
    if (!model)
        return;

    var asyncCalls = [];
    var metas = CoreUtils.getAllRelationsForTargetInternal(getEntity(model.modelName));

    Enumerable.from(metas).forEach(x => {
        var m: MetaData = x;
        var param: IAssociationParams = <IAssociationParams>m.params;
        if (param.embedded)
            return;

        if (force || param.eagerLoading) {
            var relModel = getModel(param.rel);
            if (m.propertyType.isArray) {
                if (val[m.propertyKey] && val[m.propertyKey].length > 0) {
                    asyncCalls.push(mongooseModel.findMany(relModel, val[m.propertyKey])
                        .then(result => {
                            var childCalls = [];
                            var updatedChild = [];
                            Enumerable.from(result).forEach(res => {
                                childCalls.push(embeddedChildren(relModel, res, false).then(r => {
                                    updatedChild.push(r);
                                }));
                            });
                            return Q.all(childCalls).then(r => {
                                val[m.propertyKey] = updatedChild;
                            });
                        }));
                }
            }
            else {
                if (val[m.propertyKey]) {
                    asyncCalls.push(mongooseModel.findOne(relModel, val[m.propertyKey])
                        .then(result => {
                            return Q.resolve(embeddedChildren(relModel, result, false).then(r => {
                                val[m.propertyKey] = r;
                            }));
                        }).catch(error => {
                            winstonLog.logError(`Error in embeddedChildren ${error}`);
                            return Q.reject(error);
                        }));
                }
            }
        }
    });

    if (asyncCalls.length == 0)
        return Q.when(val);

    return Q.allSettled(asyncCalls).then(res => {
        return val;
    });
}

/**
 * It find all children with deleteCascade = true, and delete those children.
 * Recursively, it finds all the relation with deleteCascade = true and delete them.
 * On deleting these objects, it will not update other parent doc because it is expected that these objects should not have any other parent.
 * @param model
 * @param updateObj
 */
export function deleteCascade(model: Mongoose.Model<any>, updateObj: any) {
    var relations = CoreUtils.getAllRelationsForTargetInternal(getEntity(model.modelName));
    var relationToDelete = Enumerable.from(relations).where(x => x.params.deleteCascade).toArray();
    var ids = {};
    var models = {};

    relationToDelete.forEach(res => {
        var x = <IAssociationParams>res.params;
        var prop = updateObj[res.propertyKey];
        if(!prop)
            return;
        ids[x.rel] = ids[x.rel] || [];
        if (x.embedded) {
            if (res.propertyType.isArray) {
                var id = Enumerable.from(prop).select(x => x['_id']).toArray();
                ids[x.rel] = ids[x.rel].concat(id);
            }
            else {
                ids[x.rel] = ids[x.rel].concat([prop['_id']]);
            }
        }
        else {
            ids[x.rel] = ids[x.rel].concat(res.propertyType.isArray ? prop : [prop]);
        }
        ids[x.rel] = Enumerable.from(ids[x.rel]).select(x => x.toString()).toArray();
    });

    var asyncCalls = [];
    for (var i in ids) {
        if (ids[i].length > 0) {
            models[i] = getModel(i);
            asyncCalls.push(bulkDelete(models[i], ids[i]));
        }
    }

    return Q.allSettled(asyncCalls);
}

/**
 * Autogenerate mongodb guid (ObjectId) for the autogenerated fields in the object
 * @param obj
 * throws TypeError if field type is not String, ObjectId or Object
 */
export function autogenerateIdsForAutoFields(model: Mongoose.Model<any>, obj: any): void {
    var fieldMetaArr = MetaUtils.getMetaData(getEntity(model.modelName), Decorators.FIELD);
    if (!fieldMetaArr) {
        return;
    }
    Enumerable.from(fieldMetaArr)
        .where((keyVal) => keyVal && keyVal.params && (<IFieldParams>keyVal.params).autogenerated)
        .forEach((keyVal) => {
            var metaData = <MetaData>keyVal;
            var objectId = new Mongoose.Types.ObjectId();
            if (metaData.getType() === String) {
                obj[metaData.propertyKey] = objectId.toHexString();
            } else if (metaData.getType() === Mongoose.Types.ObjectId || metaData.getType() === Object) {
                obj[metaData.propertyKey] = objectId;
            } else {
                winstonLog.logError(model.modelName + ': ' + metaData.propertyKey + ' - ' + 'Invalid autogenerated type');
                throw TypeError(model.modelName + ': ' + metaData.propertyKey + ' - ' + 'Invalid autogenerated type');
            }
        });
}

/**
 * It find all the parent document and then update them. This updation will only happen if that property have chaged
 * @param model
 * @param entityChange
 * @param obj
 * @param changedProps
 */
export function updateEmbeddedOnEntityChange(model: Mongoose.Model<any>, entityChange: EntityChange, obj: any, changedProps: Array<string>) {
    var allReferencingEntities = CoreUtils.getAllRelationsForTarget(getEntity(model.modelName));
    var asyncCalls = [];
    Enumerable.from(allReferencingEntities)
        .forEach((x: MetaData) => {
            var param = <IAssociationParams>x.params;
            if (entityChange == EntityChange.delete || Utils.isPropertyUpdateRequired(changedProps, param.properties)) {
                var newObj = getFilteredValue(obj, param.properties);
                asyncCalls.push(updateEntity(x.target, x.propertyKey, x.propertyType.isArray, newObj, param.embedded, entityChange));
            }
        });
    return Q.allSettled(asyncCalls);
}

/**
 * Add child model only if relational property have set embedded to true
 * @param model
 * @param obj
 */
export function addChildModelToParent(model: Mongoose.Model<any>, obj: any, id: any) {
    var asyncCalls = [];
    var metaArr = CoreUtils.getAllRelationsForTargetInternal(getEntity(model.modelName));
    for (var m in metaArr) {
        var meta: MetaData = <any>metaArr[m];
        if (obj[meta.propertyKey]) {
            asyncCalls.push(embedChild(obj, meta.propertyKey, meta));
        }
    }
    if (asyncCalls.length == 0) {
        return isDataValid(model, obj, id);
    }
    else {
        return Q.all(asyncCalls).then(x => {
            return isDataValid(model, obj, id);
        });
    }
}

function updateParentDocument(model: Mongoose.Model<any>, meta: MetaData, objs: Array<any>) {
    var queryCond = {};
    var ids = Enumerable.from(objs).select(x => x['_id']).toArray();
    queryCond[meta.propertyKey + '._id'] = { $in: ids };
    return Q.nbind(model.find, model)(queryCond)
        .then(result => {
            {
                var asyncCall = [];
                Enumerable.from(result).forEach(doc => {
                    var newUpdate = {};
                    var values = doc[meta.propertyKey];
                    if (meta.propertyType.isArray) {
                        var res = [];
                        values.forEach(x => {
                            var index = ids.indexOf(x['_id']);
                            if (index >= 0) {
                                res.push(objs[index]);
                            }
                            else {
                                res.push(x);
                            }
                        });
                        newUpdate[meta.propertyKey] = res;
                    }
                    else {
                        var index = ids.indexOf(values['_id']);
                        newUpdate[meta.propertyKey] = objs[index];
                    }
                    asyncCall.push(mongooseModel.put(model, doc['_id'], newUpdate));
                });
                return Q.allSettled(asyncCall);
            }
        });
}

function bulkDelete(model: Mongoose.Model<any>, ids: any) {
    return mongooseModel.findMany(model, ids).then(data => {
        return Q.nbind(model.remove, model)({
            '_id': {
                $in: ids
            }
        }).then(x => {
            var asyncCalls = [];
            // will not call update embedded parent because these children should not exist without parent
            Enumerable.from(data).forEach(res => {
                asyncCalls.push(deleteCascade(model, res));
            });

            return Q.allSettled(asyncCalls);
        });
    });
}

function patchAllEmbedded(model: Mongoose.Model<any>, prop: string, updateObj: any, entityChange: EntityChange, isEmbedded: boolean, isArray?: boolean): Q.Promise<any> {
    if (isEmbedded) {

        var queryCond = {};
        queryCond[prop + '._id'] = updateObj['_id'];

        if (entityChange === EntityChange.put
            || entityChange === EntityChange.patch
            || (entityChange === EntityChange.delete && !isArray)) {

            var cond = {};
            cond[prop + '._id'] = updateObj['_id'];

            var newUpdateObj = {};
            isArray
                ? newUpdateObj[prop + '.$'] = updateObj
                : newUpdateObj[prop] = entityChange === EntityChange.delete ? null : updateObj;

            return Q.nbind(model.update, model)(cond, { $set: newUpdateObj }, { multi: true })
                .then(result => {
                    return updateEmbeddedParent(model, queryCond, result, prop);
                }).catch(error => {
                    winstonLog.logError(`Error in patchAllEmbedded ${error}`);
                    return Q.reject(error);
                });

        }
        else {
            var pullObj = {};
            pullObj[prop] = {};
            pullObj[prop]['_id'] = updateObj['_id'];

            return Q.nbind(model.update, model)({}, { $pull: pullObj }, { multi: true })
                .then(result => {
                    return updateEmbeddedParent(model, queryCond, result, prop);
                }).catch(error => {
                    winstonLog.logError(`Error in patchAllEmbedded ${error}`);
                    return Q.reject(error);
                });
        }
    }
    else {
        // this to handle foreign key deletion only
        if (entityChange == EntityChange.delete) {
            var queryCond = {};
            if (isArray) {
                queryCond[prop] = { $in: [updateObj['_id']] };
            }
            else {
                queryCond[prop] = updateObj['_id'];
            }

            var pullObj = {};
            pullObj[prop] = {};

            if (isArray) {
                pullObj[prop] = updateObj['_id'];
                return Q.nbind(model.update, model)({}, { $pull: pullObj }, { multi: true })
                    .then(result => {
                        return updateEmbeddedParent(model, queryCond, result, prop);
                    }).catch(error => {
                        winstonLog.logError(`Error in patchAllEmbedded ${error}`);
                        return Q.reject(error);
                    });
            }
            else {
                pullObj[prop] = null;
                var cond = {};
                cond[prop] = updateObj['_id'];

                return Q.nbind(model.update, model)(cond, { $set: pullObj }, { multi: true })
                    .then(result => {
                        //console.log(result);
                        return updateEmbeddedParent(model, queryCond, result, prop);
                    }).catch(error => {
                        winstonLog.logError(`Error in patchAllEmbedded ${error}`);
                        return Q.reject(error);
                    });
            }
        }
    }
}

function updateEmbeddedParent(model: Mongoose.Model<any>, queryCond, result, property: string) {
    if (result['nModified'] == 0)
        return;

    var allReferencingEntities = CoreUtils.getAllRelationsForTarget(getEntity(model.modelName));

    var first = Enumerable.from(allReferencingEntities).where(x => (<IAssociationParams>x.params).embedded).firstOrDefault();
    if (!first)
        return;

    winstonLog.logInfo(`updateEmbeddedParent query is ${queryCond}`);
    // find the objects and then update these objects
    return Q.nbind(model.find, model)(queryCond)
        .then(updated => {

            // Now update affected documents in embedded records
            var asyncCalls = [];
            Enumerable.from(updated).forEach(x => {
                asyncCalls.push(updateEmbeddedOnEntityChange(model, EntityChange.patch, x, [property]));
            });
            return Q.all(asyncCalls);

        }).catch(error => {
            winstonLog.logError(`Error in updateEmbeddedParent ${error}`);
            return Q.reject(error);
        });
}

function isDataValid(model: Mongoose.Model<any>, val: any, id: any) {
    var asyncCalls = [];
    var ret: boolean = true;
    var metas = CoreUtils.getAllRelationsForTargetInternal(getEntity(model.modelName));
    Enumerable.from(metas).forEach(x => {
        var m: MetaData = x;
        if (val[m.propertyKey]) {
            asyncCalls.push(isRelationPropertyValid(model, m, val[m.propertyKey], id).then(res => {
                if (res != undefined && !res) {
                    ret = false;
                }
            }));
        }
    });
    return Q.all(asyncCalls).then(f => {
        if (!ret) {
            winstonLog.logError('Invalid value. Adding these properties will break the relation.');
            throw 'Invalid value. Adding these properties will break the relation.'
        }
    });
}

function isRelationPropertyValid(model: Mongoose.Model<any>, metadata: MetaData, val: any, id: any) {
    switch (metadata.decorator) {
        case Decorators.ONETOMANY: // for array of objects
            if (metadata.propertyType.isArray) {
                if (Array.isArray(val) && val.length > 0) {
                    var queryCond = [];
                    var params = <IAssociationParams>metadata.params;
                    Enumerable.from(val).forEach(x => {
                        var con = {};
                        if (params.embedded) {
                            con[metadata.propertyKey + '._id'] = x['_id'];
                        }
                        else {
                            con[metadata.propertyKey] = { $in: [x] };
                        }
                        queryCond.push(con);
                    });
                    return Q.nbind(model.find, model)(getQueryCondition(id, queryCond))
                        .then(result => {
                            if (Array.isArray(result) && result.length > 0)
                                return false;
                            else
                                return true;
                        }).catch(error => {
                            winstonLog.logError(`Error in isRelationPropertyValid ${error}`);
                            return Q.reject(error);
                        });
                }
            }
            break;
        case Decorators.ONETOONE: // for single object
            if (!metadata.propertyType.isArray) {
                if (!Array.isArray(val)) {
                    var queryCond = [];
                    var con = {};
                    var params = <IAssociationParams>metadata.params;
                    if (params.embedded) {
                        con[metadata.propertyKey + '._id'] = val['_id'];
                    }
                    else {
                        con[metadata.propertyKey] = { $in: [val] };
                    }
                    queryCond.push(con);

                    return Q.nbind(model.find, model)(getQueryCondition(id, queryCond))
                        .then(result => {
                            if (Array.isArray(result) && result.length > 0) {
                                return false;
                            }
                        }).catch(error => {
                            winstonLog.logError(`Error in isRelationPropertyValid ${error}`);
                            return Q.reject(error);
                        });
                }
            }
            break;
        case Decorators.MANYTOONE: // for single object
            // do nothing
            return Q.when(true);
        case Decorators.MANYTOMANY: // for array of objects
            // do nothing
            return Q.when(true);
    }
    return Q.when(true);
}

function getQueryCondition(id: any, cond: any): any {
    if (id) {
        return {
            $and: [
                { $or: cond },
                { '_id': { $ne: id } }
            ]
        };
    }
    else {
        return { $or: cond }
    }
}

function updateEntity(targetModel: Object, propKey: string, targetPropArray: boolean, updatedObject: any, embedded: boolean, entityChange: EntityChange): Q.Promise<any> {
    var meta = MetaUtils.getMetaData(targetModel, Decorators.DOCUMENT);

    if (!meta) {
        throw 'Could not fetch metadata for target object';
    }

    var targetModelMeta = meta[0];
    var repoName = (<IDocumentParams>targetModelMeta.params).name;
    var model = getModel(repoName);
    if (!model) {
        winstonLog.logError('no repository found for relation');
        throw 'no repository found for relation';
    }
    return patchAllEmbedded(model, propKey, updatedObject, entityChange, embedded, targetPropArray);
}

function embedChild(obj, prop, relMetadata: MetaData): Q.Promise<any> {
    if (!obj[prop])
        return;

    if (relMetadata.propertyType.isArray && !(obj[prop] instanceof Array)) {
        winstonLog.logError('Expected array, found non-array');
        throw 'Expected array, found non-array';
    }
    if (!relMetadata.propertyType.isArray && (obj[prop] instanceof Array)) {
        winstonLog.logError('Expected single item, found array');
        throw 'Expected single item, found array';
    }

    var createNewObj = [];
    var params: IAssociationParams = <any>relMetadata.params;
    var relModel = getModel(params.rel);
    var val = obj[prop];
    var newVal = val;
    var prom: Q.Promise<any> = null;

    if (relMetadata.propertyType.isArray) {
        newVal = [];
        var objs = [];
        for (var i in val) {
            if (CoreUtils.isJSON(val[i])) {
                if (val[i]['_id']) {
                    newVal.push(val[i]['_id']);
                }
                else {
                    objs.push(val[i]);
                }
            }
            else {
                newVal.push(val[i]);
            }
        }
        if (objs.length > 0) {
            prom = mongooseModel.bulkPost(relModel, objs);
        } else {
            obj[prop] = newVal;
        }
    }
    else {
        if (CoreUtils.isJSON(val)) {
            if (val['_id']) {
                obj[prop] = val['_id'];
            }
            else {
                prom = mongooseModel.post(relModel, val);
            }
        }
    }

    if (prom) {
        return prom.then(x => {
            if (x) {
                if (x instanceof Array) {
                    x.forEach(v => {
                        newVal.push(v['_id']);
                    });
                }
                else {
                    newVal = x['_id'];
                }
                obj[prop] = newVal;
            }
            return fetchAndUpdateChildren(relModel, relMetadata, obj, prop);

        });
    }
    else {
        return fetchAndUpdateChildren(relModel, relMetadata, obj, prop);
    }
}

function fetchAndUpdateChildren(relModel, relMetadata, obj, prop) {
    var params: IAssociationParams = <any>relMetadata.params;
    return mongooseModel.findMany(relModel, castAndGetPrimaryKeys(obj, prop, relMetadata))
        .then(result => {
            if (result && result.length > 0) {
                if (params.embedded) {
                    obj[prop] = obj[prop] instanceof Array ? getFilteredValues(result, params.properties) : getFilteredValue(result[0], params.properties);
                }
                else {
                    // Verified that foriegn keys are correct and now update the Id
                    obj[prop] = obj[prop] instanceof Array ? Enumerable.from(result).select(x => x['_id']).toArray() : result[0]['_id'];
                }
            }
        }).catch(error => {
            winstonLog.logError(`Error: ${error}`);
            return Q.reject(error);
        });
}

function getFilteredValues(values: [any], properties: [string]) {
    var result = [];
    values.forEach(x => {
        var val = getFilteredValue(x, properties);
        if (val) {
            result.push(val);
        }
    });
    return result;
}

function getFilteredValue(value, properties: [string]) {
    if (properties && properties.length > 0) {
        var json = {};
        if (value['_id']) {
            json['_id'] = value['_id'];
        }
        properties.forEach(x => {
            if (value[x])
                json[x] = value[x];
        });
        if (JSON.stringify(json) == '{}') {
            return null;
        }
        return json;
    }
    else {
        return value;
    }
}

function castAndGetPrimaryKeys(obj, prop, relMetaData: MetaData): Array<any> {
    var primaryMetaDataForRelation = CoreUtils.getPrimaryKeyMetadata(relMetaData.target);

    if (!primaryMetaDataForRelation) {
        winstonLog.logError('primary key not found for relation');
        throw 'primary key not found for relation';
    }

    var primaryType = primaryMetaDataForRelation.getType();
    return obj[prop] instanceof Array
        ? Enumerable.from(obj[prop]).select(x => Utils.castToMongooseType(x, primaryType)).toArray()
        : [Utils.castToMongooseType(obj[prop], primaryType)];
}