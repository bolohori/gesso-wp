'use strict';

const { dest, lastRun, parallel, series, src, watch, task } = require('gulp');
const patternLabConfig = require('./pattern-lab-config.json');
const patternLab = require('@pattern-lab/core')(patternLabConfig);
const postcss = require('gulp-postcss');
const sass = require('gulp-sass');
const sassGlob = require('gulp-sass-glob');
const sourcemaps = require('gulp-sourcemaps');
const stylelint = require('gulp-stylelint');
const yaml = require('yaml');
const rename = require('gulp-rename');

const fs = require('fs');
const path = require('path');
const util = require('util');

const webpack = require('webpack');
const asyncWebpack = util.promisify(webpack);

const readSource = require('./lib/readSource');
const transform = require('./lib/transform');
const renderSass = require('./lib/renderSass');

const writeFile = util.promisify(fs.writeFile);
const os = require('os');

const buildConfig = async () => {
  const scssDir = path.join(__dirname, '/source/_patterns/00-config');
  const ymlDir = path.join(__dirname, './source/_data');

  const parsed = await readSource(
    path.join(
      __dirname,
      './source/_patterns/00-config/config.design-tokens.yml'
    )
  );
  const dataComment =
    '# DO NOT EDIT THIS FILE.  This is a gitignored artifact created by Gulp.' +
    os.EOL +
    '# Design tokens should be edited in _patterns/00-config/config.design-tokens.yml';

  const transformed = transform(parsed);
  const sassComment =
    '// DO NOT EDIT THIS FILE.  This is a gitignored artifact created by Gulp.' +
    os.EOL +
    '// Design tokens should be edited in config.design-tokens.yml';

  await Promise.all([
    writeFile(
      path.join(ymlDir, 'design-tokens.artifact.yml'),
      dataComment + os.EOL + yaml.stringify(transformed.data)
    ),
    writeFile(
      path.join(scssDir, '_design-tokens.artifact.scss'),
      sassComment + os.EOL + renderSass(transformed.data)
    ),
  ]);
};

const lintStyles = () => {
  return src('**/*.scss', { cwd: './source', since: lastRun(lintStyles) }).pipe(
    stylelint({
      configFile: '.stylelintrc.yml',
      failAfterError: true,
      reporters: [{ formatter: 'string', console: true }],
    })
  );
};

const compileStyles = () => {
  return src('*.scss', { cwd: './source' })
    .pipe(sassGlob())
    .pipe(sourcemaps.init())
    .pipe(
      sass({
        includePaths: ['./node_modules/breakpoint-sass/stylesheets'],
        precision: 10,
      })
    )
    .pipe(
      postcss([
        require('postcss-assets')(),
        require('autoprefixer')({
          remove: false,
        }),
      ])
    )
    .pipe(sourcemaps.write('.'))
    .pipe(dest('css'));
};

const buildPatternLab = () => {
  return patternLab.build({ cleanPublic: true, watch: false });
};

async function webpackBundleScripts(mode) {
  const webpackConfig = require('./webpack.config')(mode);
  const stats = await asyncWebpack(webpackConfig);
  if (stats.hasErrors()) {
    throw new Error(stats.compilation.errors.join('\n'));
  }
}

const bundleScripts = (exports.gessoBundleScripts = () =>
  webpackBundleScripts('production'));

const bundleScriptsDev = () => webpackBundleScripts('development');

const watchFiles = () => {
  watch(
    [
      'source/**/*.scss',
      'images/*.svg',
      '!source/_patterns/00-config/_config.artifact.design-tokens.scss',
    ],
    { usePolling: true, interval: 1500 },
    series(lintStyles, buildStyles)
  );
  watch(
    ['source/_patterns/00-config/config.design-tokens.yml'],
    { usePolling: true, interval: 1500 },
    series(
      buildConfig,
      parallel(series(lintStyles, buildStyles), buildPatternLab),
      parallel(series(lintStyles, buildStyles), buildPatternLab)
    )
  );
  watch(
    [
      'source/**/*.{twig,json,yaml,yml}',
      '!source/_patterns/00-config/config.design-tokens.yml',
    ],
    { usePolling: true, interval: 1500 },
    buildPatternLab
  );
  watch(
    ['js/src/**/*.es6.js'],
    { usePolling: true, interval: 1500 },
    bundleScriptsDev
  );
};

const buildStyles = (exports.buildStyles = series(lintStyles, compileStyles));

const build = (isProduction = true ) =>  {
  const scriptTask = isProduction ? bundleScripts : bundleScriptsDev;
  task('bundleScripts', scriptTask)
  return series(
    buildConfig,
    parallel(task('bundleScripts'), buildStyles, buildPatternLab));
}

exports.build = build(true);

exports.default = series(build(false), watchFiles);
