import * as TeacherModel from './teachermodel';
import * as CourseModel from './coursemodel';
import {field, document, onetomany, manytoone, manytomany} from '../decorators';
import {IUser} from './user';
import {Types} from 'mongoose';
import {Strict} from '../enums';

@document({ name: 'students', strict: Strict.true })
export class StudentModel {
    @field({ primary: true, autogenerated: true })
    _id: Types.ObjectId;

    @field()
    name: string;

    @field()
    age: number;

    @field()
    gender: string;

    @onetomany({ rel: 'courses', itemType: CourseModel, embedded: true })
    course: CourseModel.CourseModel;

    @onetomany({ rel: 'courses', itemType: CourseModel, embedded: true})
    courses: Array<CourseModel.CourseModel>;

    @onetomany({ rel: 'teachers', itemType: TeacherModel, embedded:true})
    teachers: Array<TeacherModel.TeacherModel>;

    @onetomany({ rel: 'teachers', itemType: TeacherModel, embedded: true })
    favouriteTeacher: TeacherModel.TeacherModel;
}

export default StudentModel;