import { Controller, Get, Query } from '@nestjs/common';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('spend')
  spend() {
    return this.usage.spend();
  }

  @Get('tickets')
  tickets() {
    return this.usage.tickets();
  }

  @Get('models')
  models(@Query('from') from?: string, @Query('to') to?: string) {
    return this.usage.models({ from, to });
  }

  @Get('summary')
  summary() {
    return this.usage.summary();
  }
}
