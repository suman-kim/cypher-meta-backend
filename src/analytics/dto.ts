import { IsOptional, IsString, Length, MaxLength } from "class-validator";

export class TrackDto {
  @IsString()
  @Length(1, 512)
  path: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  event?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(190)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  visitorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  userAgent?: string;
}
