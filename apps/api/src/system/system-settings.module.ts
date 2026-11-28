import { Module } from '@nestjs/common';
import { CommitSigningCheck } from './commit-signing-check';
import { SystemController } from './system.controller';
import { SystemSettingsService } from './system-settings.service';

@Module({ controllers: [SystemController], providers: [SystemSettingsService, CommitSigningCheck], exports: [SystemSettingsService] })
export class SystemSettingsModule {}
