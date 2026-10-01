#!/usr/bin/env node
import {main,reportError} from './install.mjs';
try{main(['uninstall',...process.argv.slice(2)]);}catch(error){reportError(error);}
