#!/usr/bin/env node
import {main,reportError} from './install.mjs';
main(['uninstall',...process.argv.slice(2)]).catch(reportError);
