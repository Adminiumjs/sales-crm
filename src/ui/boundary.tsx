/**
 * A page that throws while it is drawn does not take the frame with it: the
 * menu and the bar stay, and the page says so and offers to draw itself again.
 * It is reset when the person goes somewhere else.
 */
import { Component, type ReactNode } from "react";

export class PageBoundary extends Component<{ at: string; children: ReactNode; fallback: (again: () => void) => ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(before: { at: string }): void {
    if (before.at !== this.props.at && this.state.failed) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children;
  }
}
