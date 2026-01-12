import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  _id!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  username!: string;

  @Prop({ default: 0, min: 0 })
  balance!: number;

  @Prop({ default: 0, min: 0 })
  frozenBalance!: number;

  @Prop({ default: false })
  isBot!: boolean;

  @Prop({ default: 0 })
  version!: number;

  @Prop({ unique: true, sparse: true })
  telegramId?: number;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop()
  photoUrl?: string;

  @Prop()
  languageCode?: string;

  @Prop({ default: false })
  isPremium!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
