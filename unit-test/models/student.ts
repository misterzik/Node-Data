﻿import Mongoose = require("mongoose");
import {Types} from 'mongoose';
import {course} from './course';
import {field, document} from '../../mongoose/decorators';
import {Strict} from '../../mongoose/enums/';
import {onetomany, manytoone, manytomany, onetoone} from '../../core/decorators';

@document({ name: 'student', strict: Strict.throw })
export class student {
    schema(): {} {
        return {
            '_id': Mongoose.Schema.Types.ObjectId,
            'name': String,
            'courses': Mongoose.Schema.Types.Mixed
        };
    }

    @field({ primary: true, autogenerated: true })
    _id: Types.ObjectId;

    @field()
    name: String;

    @onetoone({ rel: 'course', itemType: course, embedded: true })
    courseOTO: course;

    @onetoone({ rel: 'course', itemType: course, embedded: false })
    courseIdOTO: course;

    @onetomany({ rel: 'course', itemType: course, embedded: true })
    courseOTM: Array<course>;

    @onetomany({ rel: 'course', itemType: course, embedded: false })
    courseIdOTM: Array<course>;

    @manytoone({ rel: 'course', itemType: course, embedded: true })
    courseMTO: course;

    @manytoone({ rel: 'course', itemType: course, embedded: false })
    courseIdMTO: course;

    @manytomany({ rel: 'course', itemType: course, embedded: true })
    courseMTM: Array<course>;

    @manytomany({ rel: 'course', itemType: course, embedded: false })
    courseIdMTM: Array<course>;
}

export default student;