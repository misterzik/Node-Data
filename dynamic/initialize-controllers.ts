﻿var Mongoose = require("mongoose");
var MongooseSchema = Mongoose.Schema;
import {DynamicController} from './dynamic-controller';
import {UserRepository} from '../repositories1/userrepository';
import {AuthController} from '../dynamic/auth-Controller'

export class InitializeControllers {
    constructor(mongooseRepoMap: { [key: string]: { fn: Function, repo: any } }) {
        this.initializeController(mongooseRepoMap);
    }

    private initializeController(mongooseRepoMap: { [key: string]: { fn: Function, repo: any } }) {
        for (var path in mongooseRepoMap) {
            var controller = new DynamicController(mongooseRepoMap[path].fn.prototype.path, mongooseRepoMap[path].repo);
        }
      
        var authController=new AuthController("", mongooseRepoMap['/user'].repo);
    }

}