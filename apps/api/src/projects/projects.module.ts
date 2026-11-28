import { Module } from '@nestjs/common';
import { BrokerClient } from '../broker/broker-client';
import { GithubReadService } from './github-read.service';
import { OnboardingService } from './onboarding.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({ controllers: [ProjectsController], providers: [ProjectsService, OnboardingService, GithubReadService, BrokerClient] })
export class ProjectsModule {}
