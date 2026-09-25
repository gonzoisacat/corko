/* Test bootstrap: y-indexeddb expects a browser indexedDB global; give
 * the node test runner an in-memory one before any module imports ydoc. */
import "fake-indexeddb/auto";
