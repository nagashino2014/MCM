import { createRoot } from "react-dom/client";
import { CdToastProvider } from "@/components/cdash";
import { SalesIntelligenceBoard } from "@/components/sales/intel/SalesIntelligenceBoard";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(<CdToastProvider><SalesIntelligenceBoard /></CdToastProvider>);
