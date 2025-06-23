import { createMemoryRouter, RouterProvider } from "react-router";
import Match from "./states/match";
import Queue from "./states/queue";

// TODO: sandbox (time trials)

const router = createMemoryRouter([
  {
    index: true,
    element: <Queue />,
  },
  {
    path: "/match/:roomId/:playerId",
    element: <Match />,
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
