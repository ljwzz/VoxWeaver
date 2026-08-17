import { EditorView } from '@codemirror/view';

interface VisualStudioEditorPalette {
  readonly activeLineNumber: string;
  readonly background: string;
  readonly cursor: string;
  readonly foreground: string;
  readonly focusBorder: string;
  readonly hiddenRegionForeground: string;
  readonly hiddenRegionShadow: string;
  readonly hoverBackground: string;
  readonly inactiveSelection: string;
  readonly info: string;
  readonly lineNumber: string;
  readonly selection: string;
  readonly selectionHighlight: string;
  readonly warning: string;
  readonly widgetBackground: string;
  readonly widgetBorder: string;
}

// Palette values follow the MIT-licensed Visual Studio Light/Dark themes in VS Code.
// Source: https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults/themes
const visualStudioLightPalette: VisualStudioEditorPalette = {
  activeLineNumber: '#0B216F',
  background: '#FFFFFF',
  cursor: '#000000',
  foreground: '#000000',
  focusBorder: '#0090F1',
  hiddenRegionForeground: '#616161',
  hiddenRegionShadow: '#737373BF',
  hoverBackground: '#E8E8E8',
  inactiveSelection: '#E5EBF1',
  info: '#0063D3',
  lineNumber: '#237893',
  selection: '#ADD6FF',
  selectionHighlight: '#ADD6FF80',
  warning: '#BF8803',
  widgetBackground: '#F3F3F3',
  widgetBorder: '#00000033',
};

const visualStudioDarkPalette: VisualStudioEditorPalette = {
  activeLineNumber: '#C6C6C6',
  background: '#1E1E1E',
  cursor: '#AEAFAD',
  foreground: '#D4D4D4',
  focusBorder: '#007FD4',
  hiddenRegionForeground: '#CCCCCC',
  hiddenRegionShadow: '#000000',
  hoverBackground: '#2A2D2E',
  inactiveSelection: '#3A3D41',
  info: '#59A4F9',
  lineNumber: '#858585',
  selection: '#264F78',
  selectionHighlight: '#ADD6FF26',
  warning: '#CCA700',
  widgetBackground: '#252526',
  widgetBorder: '#FFFFFF33',
};

export const visualStudioLightTheme = createVisualStudioTheme(visualStudioLightPalette, false);
export const visualStudioDarkTheme = createVisualStudioTheme(visualStudioDarkPalette, true);

// TODO(settings): expose Visual Studio Light/Dark selection after an appearance setting exists.
export const defaultChapterEditorTheme = visualStudioLightTheme;

function createVisualStudioTheme(
  palette: VisualStudioEditorPalette,
  dark: boolean,
) {
  return EditorView.theme({
    '&': {
      height: '100%',
      color: palette.foreground,
      backgroundColor: palette.background,
      fontSize: '13px',
    },
    '&.cm-focused': {
      outline: `1px solid ${palette.focusBorder}`,
      outlineOffset: '-1px',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: palette.cursor,
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: palette.selection,
    },
    '.cm-scroller': {
      fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: '20px',
      overflow: 'auto',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '8px 0 20px',
      caretColor: palette.cursor,
    },
    '.cm-line': {
      padding: '0 18px 0 8px',
    },
    '.cm-selectionBackground': {
      backgroundColor: palette.inactiveSelection,
    },
    '.cm-activeLine': {
      backgroundColor: palette.selectionHighlight,
    },
    '.cm-gutters': {
      minWidth: '54px',
      border: '0',
      color: palette.lineNumber,
      backgroundColor: palette.background,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '46px',
      padding: '0 12px 0 8px',
    },
    '.cm-activeLineGutter': {
      color: palette.activeLineNumber,
      backgroundColor: palette.selectionHighlight,
    },
    '.cm-chapter-heading-line': {
      backgroundColor: palette.selectionHighlight,
    },
    '.cm-chapter-content-start': {
      boxShadow: `inset 0 1px ${palette.info}33`,
    },
    '.cm-chapter-widget': {
      boxSizing: 'border-box',
      borderTop: `1px solid ${palette.info}`,
      borderBottom: `1px solid ${palette.info}`,
      color: palette.foreground,
      backgroundColor: palette.background,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-widget:focus': {
      outline: `2px solid ${palette.focusBorder}`,
      outlineOffset: '-2px',
    },
    '.cm-chapter-widget__header': {
      display: 'flex',
      minHeight: '34px',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '4px 10px',
      backgroundColor: `${palette.info}1A`,
    },
    '.cm-chapter-widget__order': {
      minWidth: '24px',
      color: palette.info,
      fontFamily: 'SFMono-Regular, Consolas, monospace',
      fontSize: '11px',
      textAlign: 'right',
    },
    '.cm-chapter-widget__title': {
      minWidth: '0',
      flex: '1 1 160px',
      overflow: 'hidden',
      fontSize: '12px',
      fontWeight: '600',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '.cm-chapter-widget__warning': {
      color: palette.warning,
    },
    '.cm-chapter-widget__anomaly': {
      display: 'flex',
      minHeight: '27px',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '3px 10px',
      borderTop: `1px solid ${palette.widgetBorder}`,
      color: palette.warning,
      backgroundColor: `${palette.warning}12`,
      fontSize: '11px',
    },
    '.cm-chapter-widget__accept-anomaly': {
      padding: '2px 7px',
      border: `1px solid ${palette.warning}`,
      borderRadius: '2px',
      color: palette.warning,
      backgroundColor: palette.background,
      cursor: 'pointer',
      font: '11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-widget__controls': {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '10px',
      marginLeft: '12px',
    },
    '.cm-chapter-widget__control-group': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
    },
    '.cm-chapter-widget__control-label': {
      minWidth: '34px',
      color: palette.hiddenRegionForeground,
      fontSize: '10px',
    },
    '.cm-chapter-widget__button': {
      width: '24px',
      height: '22px',
      padding: '0',
      border: `1px solid ${palette.widgetBorder}`,
      borderRadius: '2px',
      color: palette.foreground,
      backgroundColor: palette.background,
      cursor: 'pointer',
      font: '12px/20px SFMono-Regular, Consolas, monospace',
    },
    '.cm-chapter-widget__button:hover:not(:disabled)': {
      borderColor: palette.focusBorder,
      backgroundColor: palette.hoverBackground,
    },
    '.cm-chapter-widget__button:focus-visible, .cm-chapter-widget__accept-anomaly:focus-visible, .cm-chapter-widget__structure-action:focus-visible, .cm-chapter-action-menu__button:focus-visible': {
      outline: `1px solid ${palette.focusBorder}`,
      outlineOffset: '1px',
    },
    '.cm-chapter-widget__button:disabled': {
      opacity: '0.35',
      cursor: 'default',
    },
    '.cm-chapter-widget__structure-menu': {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginLeft: '24px',
    },
    '.cm-chapter-widget__structure-action': {
      padding: '2px 8px',
      border: `1px solid ${palette.widgetBorder}`,
      borderRadius: '2px',
      color: palette.foreground,
      backgroundColor: palette.background,
      cursor: 'pointer',
      font: '11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-widget__structure-action:disabled': {
      opacity: '0.35',
      cursor: 'default',
    },
    '.cm-chapter-widget__structure-action--delete': {
      marginLeft: '12px',
    },
    '.cm-chapter-widget__accept-anomaly:disabled': {
      opacity: '0.35',
      cursor: 'default',
    },
    '.cm-chapter-unassigned': {
      backgroundColor: `${palette.warning}26`,
      textDecoration: `underline wavy ${palette.warning}`,
      textDecorationThickness: '1px',
    },
    '.cm-chapter-fold': {
      boxSizing: 'border-box',
      position: 'relative',
      width: '100%',
      height: '24px',
      overflow: 'visible',
      color: palette.hiddenRegionForeground,
      backgroundColor: palette.widgetBackground,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-fold__edge': {
      boxSizing: 'border-box',
      position: 'absolute',
      zIndex: '1',
      left: '0',
      width: '100%',
      height: '10px',
      padding: '0',
      border: '0',
      color: 'transparent',
      backgroundColor: 'transparent',
      backgroundClip: 'content-box',
      cursor: 'default',
      fontSize: '0',
      transition: 'background-color 0.1s ease-out',
    },
    '.cm-chapter-fold__edge--top': {
      top: '-4px',
      padding: '4px 0 2px',
    },
    '.cm-chapter-fold__edge--bottom': {
      bottom: '-4px',
      padding: '2px 0 4px',
    },
    '.cm-chapter-fold:not(.dragging) .cm-chapter-fold__edge:hover, .cm-chapter-fold__edge.dragging': {
      backgroundColor: palette.focusBorder,
    },
    '.cm-chapter-fold__edge.canMoveTop:not(.canMoveBottom)': {
      cursor: 'n-resize',
    },
    '.cm-chapter-fold__edge:not(.canMoveTop).canMoveBottom': {
      cursor: 's-resize',
    },
    '.cm-chapter-fold__edge.canMoveTop.canMoveBottom': {
      cursor: 'ns-resize',
    },
    '.cm-chapter-fold__expand-all': {
      boxSizing: 'border-box',
      display: 'block',
      width: '100%',
      height: '24px',
      padding: '0 8px',
      border: '0',
      borderTop: `1px solid ${palette.widgetBorder}`,
      borderBottom: `1px solid ${palette.widgetBorder}`,
      color: palette.hiddenRegionForeground,
      backgroundColor: 'transparent',
      boxShadow: `inset 0 -5px 5px -7px ${palette.hiddenRegionShadow}, inset 0 5px 5px -7px ${palette.hiddenRegionShadow}`,
      cursor: 'pointer',
      font: '11px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-fold__expand-all:hover, .cm-chapter-refold__button:hover': {
      color: palette.foreground,
      backgroundColor: palette.hoverBackground,
    },
    '.cm-chapter-fold__edge:focus-visible, .cm-chapter-fold__expand-all:focus-visible, .cm-chapter-refold__button:focus-visible': {
      outline: `1px solid ${palette.focusBorder}`,
      outlineOffset: '-1px',
    },
    '.cm-chapter-refold': {
      boxSizing: 'border-box',
      display: 'flex',
      width: '100%',
      height: '20px',
      alignItems: 'center',
      justifyContent: 'center',
      borderTop: `1px solid ${palette.widgetBorder}`,
      borderBottom: `1px solid ${palette.widgetBorder}`,
      backgroundColor: palette.widgetBackground,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-refold__button': {
      padding: '0 8px',
      border: '0',
      color: palette.hiddenRegionForeground,
      backgroundColor: 'transparent',
      cursor: 'pointer',
      font: '10px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '&.cm-chapter-folding-dragging, &.cm-chapter-folding-dragging *': {
      userSelect: 'none',
    },
    '&.cm-chapter-folding-dragging.cm-chapter-folding-can-move-top:not(.cm-chapter-folding-can-move-bottom), &.cm-chapter-folding-dragging.cm-chapter-folding-can-move-top:not(.cm-chapter-folding-can-move-bottom) *': {
      cursor: 'n-resize !important',
    },
    '&.cm-chapter-folding-dragging:not(.cm-chapter-folding-can-move-top).cm-chapter-folding-can-move-bottom, &.cm-chapter-folding-dragging:not(.cm-chapter-folding-can-move-top).cm-chapter-folding-can-move-bottom *': {
      cursor: 's-resize !important',
    },
    '&.cm-chapter-folding-dragging.cm-chapter-folding-can-move-top.cm-chapter-folding-can-move-bottom, &.cm-chapter-folding-dragging.cm-chapter-folding-can-move-top.cm-chapter-folding-can-move-bottom *': {
      cursor: 'ns-resize !important',
    },
    '.cm-chapter-action-menu': {
      display: 'flex',
      minWidth: '126px',
      alignItems: 'stretch',
      flexDirection: 'column',
      gap: '4px',
      padding: '5px',
      border: `1px solid ${palette.widgetBorder}`,
      borderRadius: '3px',
      color: palette.foreground,
      backgroundColor: palette.widgetBackground,
      boxShadow: `0 2px 8px ${palette.hiddenRegionShadow}33`,
    },
    '.cm-chapter-action-menu__button': {
      padding: '3px 8px',
      border: `1px solid ${palette.widgetBorder}`,
      borderRadius: '2px',
      color: palette.foreground,
      backgroundColor: palette.background,
      cursor: 'pointer',
      font: '11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'left',
    },
    '.cm-chapter-action-menu__button:disabled': {
      opacity: '0.35',
      cursor: 'default',
    },
  }, { dark });
}
