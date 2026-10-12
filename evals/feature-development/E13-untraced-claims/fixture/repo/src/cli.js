#!/usr/bin/env node
import { slugify } from "./slugify.js";

process.stdout.write(slugify(process.argv.slice(2).join(" ")) + "\n");
