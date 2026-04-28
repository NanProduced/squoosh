import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import Intro from 'shared/prerendered-app/Intro';
import 'shared/custom-els/loading-spinner';

import { get, set, del, createStore } from 'idb-keyval';
import {
  RecentFileMetadata,
  fetchWithLimits,
  createPreview,
  isValidUrl,
  extractUrlsFromDragEvent,
  extractFilesFromDragEvent,
} from 'client/lazy-app/util/import-utils';

const RECENT_FILES_KEY = 'squoosh-recent-files';
const MAX_RECENT_FILES = 10;

const recentFilesStore = createStore('squoosh-db', 'recent-files');

const ROUTE_EDITOR = '/editor';

const compressPromise = import('client/lazy-app/Compress');
const swBridgePromise = import('client/lazy-app/sw-bridge');

function back() {
  window.history.back();
}

interface Props {}

interface State {
  awaitingShareTarget: boolean;
  file?: File;
  isEditorOpen: Boolean;
  Compress?: typeof import('client/lazy-app/Compress').default;
  recentFiles: RecentFileMetadata[];
  isLoadingRecentFiles: boolean;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    isEditorOpen: false,
    file: undefined,
    Compress: undefined,
    recentFiles: [],
    isLoadingRecentFiles: true,
  };

  snackbar?: SnackBarElement;
  private abortController?: AbortController;

  constructor() {
    super();

    compressPromise
      .then((module) => {
        this.setState({ Compress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load app');
      });

    swBridgePromise.then(async ({ offliner, getSharedImage }) => {
      offliner(this.showSnack);
      if (!this.state.awaitingShareTarget) return;
      const file = await getSharedImage();
      history.replaceState('', '', '/');
      this.openEditor();
      this.setState({ file, awaitingShareTarget: false });
    });

    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', this.onPopState);

    this.loadRecentFiles();
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.onPopState);
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private loadRecentFiles = async (): Promise<void> => {
    try {
      const serialized = await get<string | undefined>(RECENT_FILES_KEY, recentFilesStore);
      
      if (!serialized) {
        this.setState({ isLoadingRecentFiles: false });
        return;
      }

      const files: RecentFileMetadata[] = JSON.parse(serialized);
      
      const validFiles = files.filter((file) => 
        file.url && file.filename && file.mimeType && file.timestamp
      );

      this.setState({ 
        recentFiles: validFiles.slice(0, MAX_RECENT_FILES),
        isLoadingRecentFiles: false 
      });
    } catch {
      this.setState({ isLoadingRecentFiles: false });
    }
  };

  private saveRecentFile = async (metadata: RecentFileMetadata): Promise<void> => {
    try {
      const { recentFiles } = this.state;
      
      const existingIndex = recentFiles.findIndex((f) => f.url === metadata.url);
      
      let updatedFiles: RecentFileMetadata[];
      
      if (existingIndex >= 0) {
        updatedFiles = [
          metadata,
          ...recentFiles.slice(0, existingIndex),
          ...recentFiles.slice(existingIndex + 1),
        ];
      } else {
        updatedFiles = [metadata, ...recentFiles];
      }
      
      updatedFiles = updatedFiles.slice(0, MAX_RECENT_FILES);
      
      this.setState({ recentFiles: updatedFiles });
      
      await set(RECENT_FILES_KEY, JSON.stringify(updatedFiles), recentFilesStore);
    } catch {
      // 静默失败，不影响用户体验
    }
  };

  private addToRecentFiles = async (url: string, file: File): Promise<void> => {
    try {
      const previewDataUrl = await createPreview(file, 200, 200);
      
      const metadata: RecentFileMetadata = {
        url,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        timestamp: Date.now(),
        previewDataUrl,
      };
      
      await this.saveRecentFile(metadata);
    } catch {
      // 静默失败
    }
  };

  private onFileDrop = async (event: Event): Promise<void> => {
    const dragEvent = event as unknown as DragEvent;
    
    const files = extractFilesFromDragEvent(dragEvent);
    if (files.length > 0) {
      const file = files[0];
      this.openEditor();
      this.setState({ file });
      await this.addToRecentFiles(`file://${file.name}`, file);
      return;
    }
    
    const urls = extractUrlsFromDragEvent(dragEvent);
    if (urls.length > 0) {
      await this.fetchAndOpenUrl(urls[0]);
      return;
    }
    
    const fileDropEvent = event as FileDropEvent;
    if (fileDropEvent.files && fileDropEvent.files.length > 0) {
      const file = fileDropEvent.files[0];
      this.openEditor();
      this.setState({ file });
      await this.addToRecentFiles(`file://${file.name}`, file);
    }
  };

  private onIntroPickFile = async (file: File): Promise<void> => {
    this.openEditor();
    this.setState({ file });
    await this.addToRecentFiles(`file://${file.name}`, file);
  };

  private onUrlImport = async (url: string, file: File): Promise<void> => {
    this.openEditor();
    this.setState({ file });
    await this.addToRecentFiles(url, file);
  };

  private onRecentFileClick = async (metadata: RecentFileMetadata): Promise<void> => {
    if (isValidUrl(metadata.url)) {
      await this.fetchAndOpenUrl(metadata.url);
    } else if (metadata.url.startsWith('file://')) {
      this.showSnack('Local file paths cannot be reloaded. Please select the file again.');
    } else {
      this.showSnack('Cannot reload this file. Please select the file again.');
    }
  };

  private fetchAndOpenUrl = async (url: string): Promise<void> => {
    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = new AbortController();

    try {
      const blob = await fetchWithLimits(url, {
        signal: this.abortController.signal,
      });

      if (!blob.type.startsWith('image/')) {
        this.showSnack('The URL does not point to a valid image');
        return;
      }

      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() || 'image.unknown';
      const file = new File([blob], filename, { type: blob.type });

      this.openEditor();
      this.setState({ file });
      await this.addToRecentFiles(url, file);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      this.showSnack(err instanceof Error ? err.message : 'Failed to fetch image from URL');
    }
  };

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  private onPopState = () => {
    this.setState({ isEditorOpen: location.pathname === ROUTE_EDITOR });
  };

  private openEditor = () => {
    if (this.state.isEditorOpen) return;
    const editorURL = new URL(location.href);
    editorURL.pathname = ROUTE_EDITOR;
    history.pushState(null, '', editorURL.href);
    this.setState({ isEditorOpen: true });
  };

  render(
    {}: Props,
    { file, isEditorOpen, Compress, awaitingShareTarget, recentFiles, isLoadingRecentFiles }: State,
  ) {
    const showSpinner = awaitingShareTarget || (isEditorOpen && !Compress);

    return (
      <div class={style.app}>
        <file-drop onfiledrop={this.onFileDrop} class={style.drop}>
          {showSpinner ? (
            <loading-spinner class={style.appLoader} />
          ) : isEditorOpen ? (
            Compress && (
              <Compress file={file!} showSnack={this.showSnack} onBack={back} />
            )
          ) : (
            <Intro 
              onFile={this.onIntroPickFile} 
              onUrlImport={this.onUrlImport}
              showSnack={this.showSnack}
              recentFiles={isLoadingRecentFiles ? [] : recentFiles}
              onRecentFileClick={this.onRecentFileClick}
            />
          )}
          <snack-bar ref={linkRef(this, 'snackbar')} />
        </file-drop>
      </div>
    );
  }
}
