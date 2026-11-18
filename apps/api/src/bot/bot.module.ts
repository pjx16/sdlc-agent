import { Module } from '@nestjs/common';
import { BrokerClient } from '../broker/broker-client';
import { BotController } from './bot.controller';

@Module({ controllers: [BotController], providers: [BrokerClient] })
export class BotModule {}
