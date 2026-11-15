import { LocalDriver } from "../src/drivers/local";
import { driverContract } from "./driver-contract";

driverContract("local", () => new LocalDriver());
