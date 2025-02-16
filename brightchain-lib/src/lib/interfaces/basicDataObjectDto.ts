import { HexString } from '../types';
import { IBasicObjectDTO } from './basicObjectDto';

export interface IBasicDataObjectDTO extends IBasicObjectDTO {
  /**
   * ID of the data object. checksum of the data.
   */
  id: HexString;
  /**
   * The data to be stored
   */
  data: HexString;
  /**
   * The date this object was created
   */
  dateCreated: Date;
}
