import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { type CommitSigningResult, CommitSigningCheck } from './commit-signing-check';
import { type GlobalSettingsView, SystemSettingsService, type SystemView } from './system-settings.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly system: SystemSettingsService,
    private readonly signing: CommitSigningCheck,
  ) {}

  @Get()
  get(): Promise<SystemView> {
    return this.system.system();
  }

  /** The public key that signs the pipeline's commits, to add to GitHub as a signing key (null until the worker has made it). */
  @Get('commit-signing')
  commitSigning(): Promise<{ publicKey: string | null }> {
    return this.system.commitSigning();
  }

  /** Is that key one of the signing keys of the GitHub account behind the personal token? Then the commits show as Verified. */
  @Post('commit-signing/test')
  @HttpCode(HttpStatus.OK)
  testCommitSigning(): Promise<CommitSigningResult> {
    return this.signing.check();
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
}
