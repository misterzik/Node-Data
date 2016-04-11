﻿import Mongoose = require('mongoose');

//import aa = require('mongoose');
var Enumerable: linqjs.EnumerableStatic = require('linq');
import * as Types from './datatype';
import {Strict} from './enums/document-strict';
import {Decorators} from '../core/constants/decorators';
import {MetadataConstants} from '../core/constants';

import {IMongooseSchemaOptions,schemaGenerator} from "./mongooseSchemaGenerator";

import {DecoratorType} from '../core/enums/decorator-type';
import {MetaUtils} from "../core/metadata/utils";
import {MetaData} from '../core/metadata/metadata';
import {IDocumentParams} from './decorators/interfaces/document-params';

export class DynamicSchema {
    parsedSchema: any;
    schemaName: string;
    private target: Object;

    constructor(target: Object, name: string) {
        this.target = target;
        this.schemaName = name;
        this.parsedSchema = this.parse(target);
    }
    
    public getSchema() {
        var fieldMetaArr = MetaUtils.getMetaData(this.target, Decorators.FIELD);
        var idx = Enumerable.from(fieldMetaArr)
            .where((keyVal) => keyVal && keyVal.params && (keyVal.params).searchIndex).any();
            var options = this.getMongooseOptions(this.target);
            var mongooseOptions: IMongooseSchemaOptions = { options: options, searchIndex: idx };
        return schemaGenerator.createSchema(this.parsedSchema, mongooseOptions);
    }

    private parse(target: Object) {
        if (!target || !(target instanceof Object)) {
            throw TypeError;
        }
        var schema = {};
        var primaryKeyProp;
        var metaDataMap = this.getAllMetadataForSchema(target);
        for (var field in metaDataMap) {
            // Skip autogenerated primary column
            //if (prop === primaryKeyProp) {
            //    continue;
            //}
            var fieldMetadata = metaDataMap[field];
            if (fieldMetadata.params && (<any>fieldMetadata.params).autogenerated) {
                continue;
            }
            var paramType = fieldMetadata.propertyType;
            if (fieldMetadata.decoratorType !== DecoratorType.PROPERTY) {
                continue;
            }
            if (fieldMetadata.params && (<any>fieldMetadata.params).searchIndex) {
                schema[field] = this.getSearchSchemaTypeForParam(paramType);
            }
            else{
            schema[field] = this.getSchemaTypeForParam(paramType);
        }
        }
        return schema;
    }

    private getSearchSchemaTypeForParam(paramType) {
        var schemaType = this.getSchemaTypeForType(paramType);
        if (paramType.rel) {
            //var metaData = Utils.getPrimaryKeyMetadata(paramType.itemType);
            //var relSchema;
            //if ((<any>fieldMetadata.params).embedded) {
            //    schema[field] = paramType.isArray ? [Types.Mixed] : Mongoose.Schema.Types.Mixed;
            //} else {
            //    relSchema = { ref: paramType.rel, type: Mongoose.Schema.Types.ObjectId };
            //    schema[field] = paramType.isArray ? [relSchema] : relSchema;
            //}

            // need to handle embedding vs foreign key refs
            return paramType.isArray ? [schemaType] : schemaType;
        }
        return paramType.isArray ? [schemaType] : {type : schemaType, es_indexed : true};
    }

    private getSchemaTypeForParam(paramType) {
        var schemaType = this.getSchemaTypeForType(paramType.itemType);
        if (paramType.rel) {
            //var metaData = Utils.getPrimaryKeyMetadata(paramType.itemType);
            //var relSchema;
            //if ((<any>fieldMetadata.params).embedded) {
            //    schema[field] = paramType.isArray ? [Types.Mixed] : Mongoose.Schema.Types.Mixed;
            //} else {
            //    relSchema = { ref: paramType.rel, type: Mongoose.Schema.Types.ObjectId };
            //    schema[field] = paramType.isArray ? [relSchema] : relSchema;
            //}

            // need to handle embedding vs foreign key refs
            return paramType.isArray ? [schemaType] : schemaType;
        }
        return paramType.isArray ? [schemaType] : schemaType;
    }

    private getSchemaTypeForType(type?) {
        switch (type) {
            case Mongoose.Types.ObjectId: return Mongoose.Schema.Types.ObjectId;
            case String: return String;
            case Number: return Number;
            case Buffer: return Buffer;
            case Date: return Date;
            case Boolean: return Boolean;
            case Array: return Array;
            //case undefined: return Mongoose.Schema.Types.Mixed;
            // any or no types
            case Object:
            default: return Mongoose.Schema.Types.Mixed;
        }
    }

    private getMongooseOptions(target: Object) {
        var meta = MetaUtils.getMetaData(<any>target, Decorators.DOCUMENT);
        var documentMeta = meta[0];
        var options = <any>{};
        var params = <IDocumentParams>(documentMeta.params || <any>{});
        switch (params.strict) {
            case Strict.true: options.strict = true; break;
            case Strict.false: options.strict = false; break;
            case Strict.throw: options.strict = "throw"; break;
            default: options.strict = true; break;
        }
        return options;
    }

    private isSchemaDecorator(decorator: string) {
        return decorator === Decorators.FIELD || decorator === Decorators.ONETOMANY || decorator === Decorators.MANYTOONE || decorator === Decorators.MANYTOMANY || decorator === Decorators.ONETOONE;
    }

    private getAllMetadataForSchema(target: Object): { [key: string]: MetaData } {
        var metaDataMap: Array<MetaData> = MetaUtils.getMetaData(<any>target);
        var metaDataMapFiltered: { [key: string]: MetaData } = <any>{};
        for (var i in metaDataMap) {
            var meta: MetaData = metaDataMap[i] as MetaData;

            if (!this.isSchemaDecorator(meta.decorator))
                continue;

            if (metaDataMapFiltered[meta.propertyKey])
                throw "A property cannot have more than one schema decorator";

            metaDataMapFiltered[meta.propertyKey] = meta;
        }
        return metaDataMapFiltered;
    }
}