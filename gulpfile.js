var gulp = require("gulp");
var gulp = require('gulp-help')(gulp);
var exec = require('child_process').exec;
var tslintCustom = require('tslint');

var tsc = require("gulp-typescript");
var sourcemaps = require("gulp-sourcemaps");
var nodemon = require('gulp-nodemon');
var livereload = require('gulp-livereload');
var tslint = require('gulp-tslint');
var ignore = require('gulp-ignore');
var ciDevVersion = require('./scripts/ci-version-devbuild');
require('dotbin');
var del = require('del');

//var nodeDebug = require("gulp-node-debug");

var tsProject = tsc.createProject('tsconfig.json', {sortOutput: true, typescript: require("typescript")});

gulp.task('clean', 'Cleans the generated js files from lib directory', function () {
  return del([
    'lib/**/*'
  ]);
});

var tsFilesGlob = (function (c) {
  return c.filesGlob || c.files || 'src/**/*.ts';
})(require('./tsconfig.json'));


gulp.task('lint', 'Lints all TypeScript source files', function () {
  return gulp.src(tsFilesGlob)
    .pipe(tslint({
      tslint: tslintCustom,
      formatter: 'verbose',
      configuration: "tslint.json"
    }))
    .pipe(tslint.report());
});

gulp.task('compile-ts', ['lint'], function () {
  var errors = 0;
  var tsResult = tsProject.src()//gulp.src()
    .pipe(sourcemaps.init())
    .pipe(tsc(tsProject))
    .on("error", function () {
      errors++;
    })
    .on("finish", function () {
      if (errors !== 0) {
        console.error("Typescript error(s) found. Build Failed");
        process.exit(1);
      }
    });

  tsResult.dts.pipe(gulp.dest("./"));
  return tsResult.js
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest("./"));
});

gulp.task('live-reload', function () {
  gulp.src(["**/*.js", "!node_modules/**/*.*"])
    .pipe(livereload());
});

// gulp.task("tslint", function () {
//     return tsProject.src()
//         .pipe(ignore.exclude('*.d.ts'))
//         .pipe(tslint({
//             rulesDirectory: ['node_modules/tslint-microsoft-contrib']
//         }))
//         .pipe(tslint.report("verbose"))
// });

gulp.task("nodemon", ["compile-ts"], function () {
  // listen for changes
  livereload.listen();
  // configure nodemon
  nodemon({
    // the script to run the app
    script: "server.js",
    ext: 'js'
  }).on('start', function () {
    // when the app has restarted, run livereload.
    gulp.src("server.js")
      .pipe(livereload());
  })
});

gulp.task("watch", function () {
  gulp.watch("./**/*.ts", ["compile-ts", "live-reload"]);
})

gulp.task("ci-dev", function () {
  ciDevVersion.setNewDevBuildVersion('package.json');
});

// Task
gulp.task('default', ["nodemon", "watch"]);

gulp.task('ts', ["compile-ts"]);
