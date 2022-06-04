#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Backend2Stack } from '../lib/backend2-stack';

const app = new cdk.App();
new Backend2Stack(app, 'Backend2Stack', {
  env: { account: process.env.ACCOUNT, region: process.env.REGION ?? 'us-east-1' },
});