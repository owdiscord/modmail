import { createUserRegistration } from "../data/Registration";
import type { ModuleProps } from "../plugins";
import { Emoji } from "../style";
import { isSnowflake } from "../utils";

export default ({ db, commands }: ModuleProps) => {
  console.log("Adding register commmand");

  commands.addInboxServerCommand(
    "register",
    [
      { name: "userId", type: "string" },
      { name: "name", type: "string" },
    ],
    async (msg, args, _thread) => {
      if (!msg.channel.isSendable()) return;

      const roleList = msg.member?.roles.cache;
      // 1462792136419311679 = test server admin role ID
      // 259251598621016074 = real server admin role ID

      if (!roleList?.hasAny("1462792136419311679", "259251598621016074")) {
        msg.channel.send(
          `Sorry! You can't use this command, it is ${Emoji.Roles.Admin} **Admin Only!**`,
        );
        return;
      }

      const { userId, name } = args as {
        userId: string;
        name: string;
      };

      if (!isSnowflake(userId)) {
        msg.channel.send(`The user ID given is not a snowflake.`);
        return;
      }

      try {
        await createUserRegistration(db, userId, name);
        msg.channel.send(
          `User <@${userId}> is now registered as **"${name}"**`,
        );
      } catch (err) {
        msg.channel.send(
          `Looks like we have an issue registering that user: ${err}`,
        );
      }
    },
    {},
  );
};
