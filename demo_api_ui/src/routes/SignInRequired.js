import TopNav from "../components/TopNav";
import SignInPrompt from "../components/SignInPrompt";

/**
 * Signed-out visitor on a user-level route: display the page chrome with a
 * sign-in prompt that returns here after login. Standing rule: never silently
 * redirect to home, and never bounce to the IdP without showing the page first.
 */
export default function SignInRequired() {
  return (
    <>
      <TopNav user={null} onLogout={() => {}} />
      <main className="main-content">
        <SignInPrompt message="This page needs a signed-in session." />
      </main>
    </>
  );
}
