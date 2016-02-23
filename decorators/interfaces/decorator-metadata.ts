import {FieldMetaData} from './field-metadata';
import {MetaData} from '../metadata/metadata';

// {decorator: {
//         "field": {
//             "_id": {
//                 
//             },
//             "name":{
//                 
//             }
//         },
//         "onetomany": {}    
//     }
// }
export interface DecoratorMetaData {
    decorator: { [key: string]: { [key: string]: MetaData }};
}