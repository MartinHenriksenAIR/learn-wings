import {makeProject} from '@revideo/core';
import scene from './scenes/scene?scene';
import './global.css';

export default makeProject({
  scenes: [scene],
  settings: {
    shared: {
      size: {x: 1920, y: 1080},
    },
    rendering: {
      exporter: {
        name: '@revideo/core/ffmpeg',
        options: {format: 'mp4'},
      },
    },
  },
});
