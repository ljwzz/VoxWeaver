interface BodyClassState {
  count: number;
  existed: boolean;
}

const bodyClassStates = new Map<string, BodyClassState>();
let nextDocumentId = 0;

function retainBodyClass(className: string): void {
  const current = bodyClassStates.get(className);

  if (current) {
    current.count += 1;
    return;
  }

  bodyClassStates.set(className, {
    count: 1,
    existed: document.body.classList.contains(className),
  });
  document.body.classList.add(className);
}

function releaseBodyClass(className: string): void {
  const current = bodyClassStates.get(className);

  if (!current)
    return;

  current.count -= 1;

  if (current.count > 0)
    return;

  if (!current.existed)
    document.body.classList.remove(className);

  bodyClassStates.delete(className);
}

export function mountPageDocument(
  bodyClasses: readonly string[],
  styleSheets: readonly string[],
): () => void {
  const documentId = nextDocumentId += 1;
  const styleElements = styleSheets.map((css, index) => {
    const style = document.createElement('style');

    style.dataset.pageStyle = `${documentId}:${index}`;
    style.textContent = css;
    document.head.append(style);

    return style;
  });

  for (const className of bodyClasses)
    retainBodyClass(className);

  return () => {
    for (const style of styleElements)
      style.remove();

    for (const className of bodyClasses)
      releaseBodyClass(className);
  };
}
