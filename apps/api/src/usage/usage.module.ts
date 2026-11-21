import { Module } from '@nestjs/common';
import { SystemSettingsModule } from '../system/system-settings.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({ imports: [SystemSettingsModule], controllers: [UsageController], providers: [UsageService] })
export class UsageModule {}
