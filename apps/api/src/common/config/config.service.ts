import { Injectable } from '@nestjs/common';
import { type Env, loadEnv } from './env.schema';

@Injectable()
export class ConfigService {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }
}
