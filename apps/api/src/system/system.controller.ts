import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { type GlobalSettingsView, SystemSettingsService, type SystemView } from './system-settings.service';

@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemSettingsService) {}

  @Get()
  get(): Promise<SystemView> {
    return this.system.system();
  }

  @Patch('settings')
  update(@Body() body: unknown): Promise<GlobalSettingsView> {
    return this.system.update(body);
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  pause(): Promise<GlobalSettingsView> {
    return this.system.pause();
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  resume(): Promise<GlobalSettingsView> {
    return this.system.resume();
  }

  @Post('usage/ignore')
  @HttpCode(HttpStatus.OK)
  ignoreUsage(@Body() body: unknown): Promise<GlobalSettingsView> {
    return this.system.ignoreUsage(body);
  }

  @Post('intake/pause')
  @HttpCode(HttpStatus.OK)
  pauseIntake(): Promise<GlobalSettingsView> {
    return this.system.setIntakePaused(true);
  }

  @Post('intake/resume')
  @HttpCode(HttpStatus.OK)
  resumeIntake(): Promise<GlobalSettingsView> {
    return this.system.setIntakePaused(false);
  }

  @Post('intake/:source/pause')
  @HttpCode(HttpStatus.OK)
  pauseIntakeSource(@Param('source') source: string): Promise<GlobalSettingsView> {
    return this.system.setSourceIntakePaused(source, true);
  }

  @Post('intake/:source/resume')
  @HttpCode(HttpStatus.OK)
  resumeIntakeSource(@Param('source') source: string): Promise<GlobalSettingsView> {
    return this.system.setSourceIntakePaused(source, false);
  }
}
