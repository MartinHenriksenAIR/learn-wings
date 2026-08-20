import {makeScene2D, Rect, Txt} from '@revideo/2d';
import {all, easeInCubic, easeOutBack, easeOutCubic, useScene, waitFor} from '@revideo/core';

export default makeScene2D('scene', function* (view) {
  const variant = useScene().variables.get('variant', 'main')();
  void variant;

  view.fill('#f1f2f5');

  const box = new Rect({y: -600, width: 220, height: 180, radius: 8, fill: '#D97757'});
  const caption = new Txt({
    text: 'smoke render ok',
    y: -330,
    fontFamily: 'Hanken Grotesk, sans-serif',
    fontWeight: 800,
    fontSize: 76,
    fill: '#171a26',
    opacity: 0,
  });
  view.add(box);
  view.add(caption);

  yield* box.y(200, 0.6, easeInCubic);
  yield* all(
    box.scale([1.12, 0.86], 0.09, easeOutCubic),
    caption.opacity(1, 0.33, easeOutCubic),
  );
  yield* box.scale(1, 0.3, easeOutBack);
  yield* waitFor(1);
});
